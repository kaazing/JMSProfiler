(function profiler() {
    "use strict";

    var wsf = new WebSocketFactory();
    // Will save the web socket so we can attach event listeners to it later
    interceptSocketCreation(wsf, function (ws) {
        wsf.wrappedWebSocket = ws;
    });
    installForm(wsf);

    function performSampling(wsFactory, url, topics, sampleLimit, timeLimit) {
        requestConnection(url, wsFactory).then(
            function (connection) {
                return collectAll(wsFactory, connection, topics, sampleLimit, timeLimit);
            }
        ).then(plotData)
            .catch(function (error) {
                console.log("Failed!", error.message);
            });
    }


    /**
     * Call on load to wire up the form
     */
    function installForm(wsFactory) {
        var form = document.forms[0];
        if (window.localStorage) {
            var settings = window.localStorage.JMSProfiler;
            if (settings) {
                settings = JSON.parse(settings);
                ['topics', 'timeout', 'samples'].forEach(
                    function(key) {
                       form.elements[key].value = settings[key];
                    }
                )
            }

        }
        form.onsubmit = function (e) {
            e.preventDefault()
        };
        form.elements.url.value = makeURL('jms');
        form.elements.start.onclick = function () {
            submit(form, wsFactory);
        };
    }

    function makeURL(service, protocol) {
        protocol = protocol || location.authority
        // detect explicit host:port authority
        var authority = location.host;
        if (location.search) {
            authority = location.search.slice(1) + '.' + authority;
        } else {
            var hostPort = authority.split(':');
            var ports = {
                http: '80',
                https: '443'
            };
            authority = hostPort[0] + ':'
                + (parseInt(hostPort[1] || ports[location.protocol]));
        }
        return 'ws://' + authority + '/' + service;
    }

    /**
     *   Wraps the WebSocket factory with a promise that returns
     *   the websocket so we can instrument it later.
     */

    function interceptSocketCreation(wsFactory, intercept) {
        var superCreate = WebSocketFactory.prototype.createWebSocket;

        wsFactory.__proto__.createWebSocket = (function () {
            return function (location, protocols) {
                var webSocket = superCreate.call(wsFactory, location, protocols);
                intercept(webSocket);
                return webSocket;
            }
        })();
    }

    function submit(form, wsFactory) {

        var errors = {count: 0, url: [], topics: [], samples: [], timeout: []};

        function addError(field, error) {
            errors.count++;
            errors[field].push(error);
        }

        function require(field, value) {
            if (!value || !(value.trim())) addError(field, 'required')
        };

        var url = form.elements.url.value;
        var topicNames = form.elements.topics.value;
        var samples = form.elements.samples.value;
        var timeout = form.elements.timeout.value;

        require('url', url);
        require('topics', topicNames);
        require('samples', samples);
        require('timeout', timeout);

        // extract the topic names
        var topics = (topicNames || '').trim().split('\n')
            .filter(function (name) {
                return name.trim()
            })
            .map(function (name) {
                name = name.trim();
                return (name.indexOf('/topic/') >= 0) ? name : ('/topic/' + name);
            });
        // be nice to the user and show the values we're using
        form.elements.topics.value = topics.join('\n');

        samples = (samples || '').trim();
        if (!/^(\+)?[0-9]+$/.test(samples)) addError('samples', 'Must be an integer > 0');
        samples = parseInt(samples);

        timeout = (timeout || '').trim();
        if (!/^(\+)?[0-9.]+$/.test(samples)) addError('timeout', 'Must be an number > 0');
        timeout = parseFloat(timeout);

        // Update the form to reflect the error status
        ['url', 'topics', 'samples'].forEach(function (field) {
            var group = document.querySelector('.' + field + '-group'); // e.g. .url-group
            var messageField = group.querySelector('.message');
            var message = errors[field].join(', ');
            if (!message) {
                group.classList.remove('has-error');
            } else {
                group.classList.add('has-error');
                messageField.innerHTML = message;
            }
            messageField.hidden = !message;
        });

        if (!errors.count) {
            if (window.localStorage) {
                window.localStorage.JMSProfiler = JSON.stringify({topics: (form.elements.topics.value), timeout: (timeout), samples: (samples)});
            }
            performSampling(wsFactory, url, topics, samples, timeout);

        }
    }


    /**
     * Sets up the connection at url and returns a promise with the connection.
     *
     * @param url
     */
    function requestConnection(url, wsFactory) {
        return new Q.Promise(function (resolve, reject) {
            var factory = new JmsConnectionFactory(url);
            factory.setWebSocketFactory(wsFactory);
            var future = factory.createConnection(function () {
                try {
                    var connection = future.getValue();
                    resolve(connection);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    function collectAll(wsFactory, connection, topics, sampleLimit, timeLimit) {
        return new Q.Promise(function (resolve, reject, progress) {
            var result = [];
            topics.reduce(function (sequence, topic) {
                return sequence.then(function () {
                    return collectData(wsFactory.wrappedWebSocket, connection, topic, sampleLimit, timeLimit)
                })
                    .then(function (samples) {
                        result.push({topic: (topic), samples: (samples)});
                    });
            }, Q.Promise.resolve())
                .then(function () {
                    resolve(result)
                }).catch(function (error) {
                    console.log('returning error');
                    reject(error);
                });
        });
    }

    function collectData(webSocket, connection, topicName, sampleLimit, timeLimit) {

        return new Q.Promise(function (resolve, reject, progress) {

            console.log('connecting to ' + topicName);

            var session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
            // TODO handle errors when creating topic listeners
            var topic = session.createTopic(topicName);
            var consumer = session.createConsumer(topic);

            consumer.setMessageListener(function (msg) {
            });

            var wsSamples = [], jmsTimes = [];

            /**
             * @returns a promise that resolves when the connection has been started.
             */
            function startConnection() {
                return new Q.Promise(function (resolve) {
                    function connectionStarted() {
                        resolve();
                    }

                    console.log('...waiting on connection start');
                    connection.start(connectionStarted);
                });
            }

            function stopConnection() {
                return new Q.Promise(function (resolve) {
                    function connectionStopped() {
                        resolve();
                    }

                    connection.stop(connectionStopped);
                });
            }

            function collectSamples() {
                return new Q.Promise(function (resolve, reject, progress) {

                    function wsMessageListener(event) {
                        // event.data is a ByteBuffer
                        if (wsSamples.length < sampleLimit) {
                            wsSamples.push(event.data.limit);
                        } else {
                            resolve();
                        }
                    }

                    console.log('...sampling');
                    webSocket.addEventListener('message', wsMessageListener, false);
                });
            }

            function closeSession() {
                return new Q.Promise(function (resolve) {
                    function sessionClosed() {
                        session = null;
                        resolve();
                    }

                    console.log('...closing session');
                    session.close(sessionClosed);
                });
            }

            startConnection()
                .then(collectSamples)
                .then(stopConnection)
                .then(closeSession)
                .then(function () {
                    resolve(wsSamples);
                })
                .catch(function (error) {
                    reject(error);
                });

        });
    }


// ========================================================
// Charting


    function plotData(data) {
        var margin = {top: 20, right: 80, bottom: 30, left: 50},
            width = 960 - margin.left - margin.right,
            height = 500 - margin.top - margin.bottom;


        var svg = d3.select("#chart").append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        var x = d3.scale.linear()
            .range([0, width])
            .domain([0, d3.max(data, function (a) {
                return a.samples.length
            })]);

        var y = d3.scale.linear()
            .range([height, 0])
            .domain([
                0,
                d3.max(data, function (a) {
                    return d3.max(a.samples)
                })
            ]);

        var color = d3.scale.category10()
            .domain(data.map(function (d) {
                return d.topic
            }));

        var xAxis = d3.svg.axis()
            .scale(x)
            .orient("bottom");

        var yAxis = d3.svg.axis()
            .scale(y)
            .orient("left");

        var line = d3.svg.line()
            .x(function (d, i) {
                return x(i);
            })
            .y(function (d) {
                return y(d);
            })
            .defined(function (d, i) { return i } ); // No line defined at point 0

        svg.append("g")
            .attr("class", "x axis")
            .attr("transform", "translate(0," + height + ")")
            .call(xAxis);

        svg.append("g")
            .attr("class", "y axis")
            .call(yAxis)
            .append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", 6)
            .attr("dy", ".71em")
            .style("text-anchor", "end")
            .text("Payload (bytes)");


        var topic = svg.selectAll('.topic')
            .data(data)
            .enter().append('g')
            .attr('class', 'topic');

        topic.append("path")
            .attr("class", "line")
            .attr("d", function (d) {
                return line(d.samples)
            })
            .style("stroke", function (d) {
                return color(d.topic)
            });

        topic.append("text")
            .datum(function (d) {
                return {topic: d.topic, sample: (d.samples.length), value: d3.median(d.samples) }
            })
            .attr("transform", function (d) {
                return "translate(" + x(d.sample) + "," + y(d.value) + ")";
            })
            .attr("x", 3)
            .attr("dy", ".35em")
            .text(function (d) {
                return d.topic;
            })
            .style("fill", function (d) {
                return color(d.topic)
            });


    }

})();



