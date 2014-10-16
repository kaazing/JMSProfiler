# JMSProfiler

This client-side application takes a list of one or more JMS topics and plots the size of each message (as measured by the raw WebSocket packets) over time. 

Use this to measure the effects of delta compression, examine the size of different message formats on the wire, etc.

# Requirements

This expects a 4.x or later gateway. You will need to copy the `lib/client/javascript` folder into `client` as usual.

This client has been tested on recent Chrome, Firefox, and Safari. It appears to have problems on IE 10.

# Usage

1. Copy this into `$GATEWAY_HOME/web/base` or `$GATEWAY_HOME/web/extras`
2. Install a copy of the client libraries: copy `$GATEWAY_HOME/lib/client/javascript` into `JMSProfiler/client`
3. Open this app in the browser.
4. Enter the path for one or more topics (remember to prefix them with `/topic/`)
5. Press *start* to begin plotting.

# Experiments

Once you are running this, try the following:
1. Start the demo data source (or use your own data sources).
2. [Enable delta messaging](http://developer.kaazing.com/documentation/jms/4.0/admin-reference/r_stomp_service.html#deltamsg) in the gateway. Plot the results.
3. [Exclude](http://developer.kaazing.com/documentation/jms/4.0/admin-reference/r_stomp_service.html#jms_topic_properties) the *timestamp*, *expiration*, and *messageID* headers. 