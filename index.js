/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const Connection = require('./lib/connection');
const Server = require('./lib/server');

const ucp = exports;
ucp.Server = Server;

ucp.createServer = function (options, connectionListener) {
  return new Server(options, connectionListener);
};

const connections = {};

ucp.connect = function (options, connectListener) {

  if (!options) {
    throw new Error('connection options is required');
  }
  if (!options.port) {
    throw new Error('server port is required');
  }
  if (!options.password) {
    throw new Error('server password is required');
  }
  options.host = options.host || 'localhost';
  let addr = options.host + ':' + options.port;

  let connection = connections[addr];

  if (!connection) {
    connection = new Connection(options);
    connection.connect();
    connection.on('error', (error) => {
      connection.close();
      throw error;
    });

    connection.on('close', () => {
      delete connections[addr];
    });
  }

  function onConnected() {
    let stream = connection.createStream();
    connectListener(stream);
  }

  if (connection.connected) {
    onConnected();
  } else {
    connection.on('connect', onConnected);
  }
};

