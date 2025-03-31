const ejs = require('ejs');
const path = require('path');

/*******************************************************
 * homeView.js
 *
 * Returns the entire HTML for the main page as a string.
 * We dynamically insert "shots" into the shot cards.
 *******************************************************/
function buildHomeHTML(scenes) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(
      path.join(__dirname, 'templates', 'home.ejs'),
      { scenes },
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
  buildHomeHTML
};