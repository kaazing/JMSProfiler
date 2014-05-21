(function speedMeter() {
    "use strict";

// Create variables to store the connection and session            
    var session, connection;
    var commandProducer;    // Added in Lab E
    var count = 1;

    var sampling = false;
    var readyToSample = false;
    var sampleLimit = 250;
    var samples = new Array();
    var sampleNum = 0;

    var url = "ws://localhost:8000/jms";
    window.onload = function () {
        var factory = new JmsConnectionFactory(url);
        // Intercept the creation of the WebSocket to instrument it
        factory.setWebSocketFactory(wrappedFactory());
        var future = factory.createConnection(function () {
            try {
                connection = future.getValue();
//                setUp();
                installForm();
            } catch (e) {
                alert(e.message);
            }
        });
    }

    /*
     Create a function for creating a session and setting up
     Topics, Queues, Consumers, Providers, and Listeners.
     The following function is called when the connection has been created
     but before starting the flow of data.
     */
    function setUp() {
        // Typical session options shown.
        // Add your code here to set up Topics, Queues, Consumers, Providers, and Listeners.
//    var topic = session.createTopic("/topic/ticker.AAPL");
//    var consumer = session.createConsumer(topic);
//    consumer.setMessageListener(onMessage);


    }


// This function is called from the index.html page when the page loads

// ========================================================
// Wrap the WebSocket factory so we can intercept the
// returned WebSocket and instrument it.

    function wrappedFactory() {
        var factory = new WebSocketFactory();
        var superCreate = WebSocketFactory.prototype.createWebSocket;

        factory.__proto__.createWebSocket = (function () {
            return function (location, protocols) {
                var webSocket = superCreate.call(factory, location, protocols);
                return instrumentedWebSocket(webSocket);
            }

        })();

        return factory;
    }

    function instrumentedWebSocket(webSocket) {
        webSocket.addEventListener('message', trackMessagePayload, false);
        return webSocket;
    }

    function trackMessagePayload(event) {
        // event.data is a ByteBuffer
        if (!sampling) return;
        if (sampleNum < sampleLimit) {
            sampleNum++;
            samples.push(event.data.limit);
        } else {
            stopSampling();
        }
    }


    function startSampling() {

        function connectionStarted() {
            sendRateCommand(500);
        }


        session = connection.createSession(false, Session.AUTO_ACKNOWLEDGE);
        var commandQueue = session.createQueue("/queue/tickerCommand");
        commandProducer = session.createProducer(commandQueue);
        subscribeTo("/topic/stock");
//        subscribeToTopic("/topic/ticker");
//        buildSubscriptions();
        sampling = false;
        readyToSample = true;    // see onMessage below
        connection.start(connectionStarted);
    }


// This exists basically to enable sampling after the initial setup commands have been sent
    function onMessage(msg) {
        if (sampling) return;
        if (readyToSample) {
            // we were waiting for a JMS message to signal we're done with the startup negotiations
            readyToSample = false;
            sampling = true;
        }
    }


    function stopSampling() {

        function closeSession() {
            session.close();
            session = null;
        }

        sampling = readyToSample = false;
        sendRateCommand(1);   // throttle back
        connection.stop(closeSession);
        plotSamples(samples);
    }


    function subscribeTo(name) {
        var topic = session.createTopic(name);
        var consumer = session.createConsumer(topic);
        consumer.setMessageListener(onMessage);
    }

    function subscribeToPerStockTopics() {
        var symbols = ["ADBE", "AKAM", "AAPL", "BAC" , "CSCO", "C"   , "DELL", "FB"  , "GOOG", "HPQ" , "HSBC", "INFA", "INTC", "IBM" , "JPM" , "KZNG", "MSFT", "ORCL", "TIBX", "WFC"];
        symbols.forEach(function (symbol) {
            var topic = session.createTopic("/topic/ticker." + symbol);
            var consumer = session.createConsumer(topic);
            consumer.setMessageListener(onMessage);
        });
    }


// ========================================================
// Form code (for changing the rate and resetting values)

    function installForm() {
        var form = document.forms[0];
        form.onsubmit = function (e) {
            e.preventDefault()
        };
        form.elements['start'].onclick = function () {
            startSampling();
        };
    }

    function sendRateCommand(value) {
        // Your code here
        var message = session.createTextMessage('');
        value = value.toString();
        message.setStringProperty('setMessagesPerSecond', value);
        commandProducer.send(message, null);
    }

// ========================================================
// Charting


    function plotSamples(samples) {
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
            .domain([0, samples.length - 1]);

        var y = d3.scale.linear()
            .range([height, 0])
            .domain([
                d3.min(samples),
                d3.max(samples)
            ]);

        var color = d3.scale.category10();

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


        svg.append("path")
            .datum(samples)
            .attr("class", "line")
            .attr("d", line);
    }

})();

