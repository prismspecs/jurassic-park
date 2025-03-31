/*******************************************************
 * teleprompterView.js
 *   - Returns the HTML for the teleprompter page
 *******************************************************/
const ejs = require('ejs');
const path = require('path');

function buildTeleprompterHTML() {
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      path.join(__dirname, 'templates', 'teleprompter.ejs'),
      {},
      (err, html) => {
        if (err) {
          reject(err);
        } else {
          resolve(html);
        }
      }
    );
  });
}

module.exports = {
  buildTeleprompterHTML
}; 