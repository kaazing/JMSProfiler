(function speedMeter() {
    "use strict";

    var sampleLimit = 100;
    var webSocket = null;
    var topics = ["/topic/stock", "/topic/ticker", "/topic/ticker.>"];


    var url = "ws://localhost:8000/jms";
    window.onload = function () {
        var wsf = new WebSocketFactory();
        // Will save the web socket so we can attach event listeners to it later
        interceptSocketCreation(wsf, function (ws) {
            webSocket = ws
        });
        // You give me promises, promises...
        requestConnection(url, wsf).then(
            function (connection) {
                return collectAll(connection, topics);
            }
        ).then(plotData)
            .catch(function (error) {
                console.log("Failed!", error.message);
            });

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

    function collectAll(connection, topics) {
        return new Q.Promise(function (resolve, reject, progress) {
            var result = [];
            topics.reduce(function (sequence, topic) {
                return sequence.then(function () {
                    return collectData(webSocket, connection, topic)
                })
                    .then(function (samples) {
                        result.push({topic:(topic), samples:(samples)});
                    });
            }, Q.Promise.resolve())
                .then(function () {
                    resolve(result  )
                }).catch(function (error) {
                    console.log('returning error');
                    reject(error);
                });
        });
    }

    function collectData(webSocket, connection, topicName) {

        return new Q.Promise(function (resolve, reject, progress) {

            console.log("Creating session for " + topicName); // <<<
            var session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
            var commandQueue = session.createQueue("/queue/tickerCommand");
            var commandProducer = session.createProducer(commandQueue);
            var topic = session.createTopic(topicName);
            var consumer = session.createConsumer(topic);
            consumer.setMessageListener(function (msg) {
            });

            var samples = [];

            /**
             * @returns a promise that resolves when the connection has been started.
             */
            function startConnection() {
                return new Q.Promise(function (resolve) {
                    function connectionStarted() {
                        resolve();
                    }

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

            function sendRateCommand(value) {
                return new Q.Promise(function (resolve) {
                    var message = session.createTextMessage('');
                    value = value.toString();
                    message.setStringProperty('setMessagesPerSecond', value);
                    commandProducer.send(message, function () {
                        resolve()
                    });
                });
            }

            function collectSamples() {
                return new Q.Promise(function (resolve) {

                    function wsMessageListener(event) {
                        // event.data is a ByteBuffer
                        if (samples.length < sampleLimit) {
                            samples.push(event.data.limit);
                        } else {
                            resolve();
                        }
                    }

                    webSocket.addEventListener('message', wsMessageListener, false);
                });
            }

            function closeSession() {
                return new Q.Promise(function (resolve) {
                    function sessionClosed() {
                        console.log("Session closed"); // <<<
                        session = null;
                        resolve();
                    }

                    session.close(sessionClosed);
                });
            }

            startConnection()
                .then(function () {
                    sendRateCommand(500)
                })
                .then(collectSamples)
                .then(function () {
                    console.log('collected ' + samples.length + ' samples')
                })
                .then(stopConnection)
                .then(function () {
                    sendRateCommand(1)
                })
                .then(closeSession)
                .then(function () {
                    console.log('returning samples');
                    resolve(samples);
                })
                .catch(function (error) {
                    console.log('returning error');
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


        var svg = d3.select("body").append("svg")
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

        var x = d3.scale.linear()
            .range([0, width])
            .domain([0, d3.max(data, function (a) { return a.samples.length } )]);

        var y = d3.scale.linear()
            .range([height, 0])
            .domain([
                0,
                d3.max(data, function (a) { return d3.max(a.samples) })
            ]);

        var color = d3.scale.category10()
            .domain(data.map(function(d) { return d.topic }));

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
            });

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
            .datum(function(d) { return {topic: d.topic, sample: (d.samples.length), value: d3.median(d.samples) } })
            .attr("transform", function(d) { return "translate(" + x(d.sample) + "," + y(d.value) + ")"; })
            .attr("x", 3)
            .attr("dy", ".35em")
            .text(function(d) { return d.topic; })
            .style("fill", function (d) {
                return color(d.topic)
            });


    }

})();


// ========================================================
// Form code (for changing the rate and resetting values)

    function installForm() {
        var form = document.forms[0];
        form.onsubmit = function (e) {
            e.preventDefault()
        };
        form.elements['start'].onclick = function () {
            sample();
        };
    }

