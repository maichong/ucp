/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const crypto = require('crypto');

function Encryption(secret) {

  const encryption = {};

  const key = crypto.createHash('sha256').update(secret).digest();

  const iv = key.slice(10, 26);

  encryption.encrypt = function encrypt(buf) {
    const cipher = crypto.createCipheriv('aes-256-cfb', key, iv);
    return Buffer.concat([cipher.update(buf), cipher.final()]);
  };

  encryption.decrypt = function decrypt(buf) {
    const cipher = crypto.createDecipheriv('aes-256-cfb', key, iv);
    return Buffer.concat([cipher.update(buf), cipher.final()]);
  };

  return encryption;
}

module.exports = Encryption;
