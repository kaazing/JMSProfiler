JMSProfiler
===========
This client-side application takes a list of one or more JMS topics and plots the size of each message (as measured
by the raw WebSocket packets) over time. 

Use this to measure the effects of delta compression, examine the size of different message formats on the wire, etc.

Requirements
============
This expects a 4.x or later gateway. You will need to copy the lib/client/javascript folder into client as usual.
This client has been tested on recent Chrome, Firefox, and Safari. It should work on IE11.
