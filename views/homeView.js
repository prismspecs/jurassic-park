const ejs = require('ejs');
const path = require('path');
const sessionService = require('../services/sessionService');

/*******************************************************
 * homeView.js
 *
 * Returns the entire HTML for the main page as a string.
 * We dynamically insert "shots" into the shot cards.
 *******************************************************/
function buildHomeHTML(scenes) {
  const currentSessionId = sessionService.getCurrentSessionId();
  const existingSessions = sessionService.listExistingSessions();

  return new Promise((resolve, reject) => {
    ejs.renderFile(
      path.join(__dirname, 'templates', 'home.ejs'),
      {
        scenes,
        currentSessionId,
        existingSessions
      },
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