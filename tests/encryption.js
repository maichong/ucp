/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const Encryption = require('../lib/encryption');

const encryption = new Encryption('123456');

let data = new Buffer('Hello world');

console.log(data, data.length);

data = encryption.encrypt(data);

console.log(data, data.length);

data = encryption.decrypt(data);

console.log(data, data.length);

console.log(data.toString());
