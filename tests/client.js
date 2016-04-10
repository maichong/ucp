/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const utp = require('../index');

utp.connect({
  port: 30000,
  //host: '192.168.31.11',
  password: '123456'
}, function (stream) {
  console.log('on connect', stream.id);
  stream.on('data', data => {
    console.log('on data', data);
  });
  stream.write('hello world');

});
