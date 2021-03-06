/******************************************************************************
Copyright (c) 2012, Google Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimer in the documentation
      and/or other materials provided with the distribution.
    * Neither the name of Google, Inc. nor the names of its contributors
      may be used to endorse or promote products derived from this software
      without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
******************************************************************************/

var logger = require('logger');
var process_utils = require('process_utils');
var webdriver = require('selenium-webdriver');

var CHROME_FLAGS = [
    '--disable-fre', '--enable-benchmarking', '--metrics-recording-only'
  ];


/**
 * Desktop Chrome browser.
 *
 * @param {webdriver.promise.ControlFlow} app the ControlFlow for scheduling.
 * @param {Object.<string>} args browser options with string values:
 *    chromedriver
 *    chrome= Chrome binary
 *    ...
 * @constructor
 */
function BrowserLocalChrome(app, args) {
  'use strict';
  logger.info('BrowserLocalChrome(%s, %s)', args.chromedriver, args.chrome);
  this.app_ = app;
  this.chromedriver_ = args.chromedriver;  // Requires chromedriver 2.x.
  this.chrome_ = args.chrome;
  this.serverPort_ = 4444;  // Chromedriver listen port.
  this.serverUrl_ = undefined;  // WebDriver server URL for WebDriver tests.
  this.devToolsPort_ = 1234;  // If running without chromedriver.
  this.devToolsUrl_ = undefined;    // If running without chromedriver.
  this.childProcess_ = undefined;
  this.childProcessName_ = undefined;
}
/** @constructor */
exports.BrowserLocalChrome = BrowserLocalChrome;

/**
 * Start chromedriver, 2.x required.
 *
 * @param {Object} browserCaps capabilities to be passed to Builder.build():
 *    #param {string} browserName must be 'chrome'.
 */
BrowserLocalChrome.prototype.startWdServer = function(browserCaps) {
  'use strict';
  var requestedBrowserName = browserCaps[webdriver.Capability.BROWSER_NAME];
  if (webdriver.Browser.CHROME !== requestedBrowserName) {
    throw new Error('BrowserLocalChrome called with unexpected browser ' +
        requestedBrowserName);
  }
  if (!this.chromedriver_) {
    throw new Error('Must set chromedriver before starting it');
  }

  var serverCommand = this.chromedriver_;
  var serverArgs = ['-port=' + this.serverPort_];
  browserCaps.chromeOptions = {args: CHROME_FLAGS.slice()};
  if (this.chrome_) {
    browserCaps.chromeOptions.binary = this.chrome_;
  }
  var loggingPrefs = {};
  loggingPrefs[webdriver.logging.Type.PERFORMANCE] =
      webdriver.logging.LevelName.ALL;  // Capture DevTools events.
  browserCaps[webdriver.Capability.LOGGING_PREFS] = loggingPrefs;
  this.startChildProcess_(serverCommand, serverArgs, 'WD server');
  this.app_.schedule('Set WD server URL', function() {
    this.serverUrl_ = 'http://localhost:' + this.serverPort_;
  }.bind(this));
};

/**
 * Start the standard non-webdriver Chrome, which can't run scripts.
 */
BrowserLocalChrome.prototype.startBrowser = function() {
  'use strict';
  // TODO(klm): clean profile, see how ChromeDriver does it.
  this.startChildProcess_(this.chrome_ || 'chrome',
      CHROME_FLAGS.concat('-remote-debugging-port=' + this.devToolsPort_),
      'Chrome');
  this.app_.schedule('Set DevTools URL', function() {
    this.devToolsUrl_ = 'http://localhost:' + this.devToolsPort_ + '/json';
  }.bind(this));
};

/**
 * @param {string} command process name.
 * @param {Array} args process args.
 * @param {string} name description for debugging.
 * @private
 */
BrowserLocalChrome.prototype.startChildProcess_ = function(
    command, args, name) {
  'use strict';
  // We expect startWdServer or startBrowser, but not both!
  if (this.childProcess_) {
    throw new Error('Internal error: WD server already running');
  }
  process_utils.scheduleSpawn(this.app_, command, args).then(
      function(proc) {
    this.childProcessName_ = name;
    this.childProcess_ = proc;
    proc.on('exit', function(code, signal) {
      logger.info('Chrome(driver) EXIT code %s signal %s', code, signal);
      this.childProcess_ = undefined;
      this.serverUrl_ = undefined;
      this.devToolsUrl_ = undefined;
    }.bind(this));
    proc.stdout.on('data', function(data) {
      logger.info('Chrome(driver) STDOUT: %s', data);
    });
    // WD STDERR only gets log level warn because it outputs a lot of harmless
    // information over STDERR
    proc.stderr.on('data', function(data) {
      logger.warn('Chrome(driver) STDERR: %s', data);
    }.bind(this));
  }.bind(this));
};

/** Kill. */
BrowserLocalChrome.prototype.kill = function() {
  'use strict';
  if (this.childProcess_) {
    process_utils.signalKill(this.childProcess_, this.childProcessName_);
  } else {
    logger.debug('%s process already unset', this.childProcessName_);
  }
  this.childProcess_ = undefined;
  this.serverUrl_ = undefined;
  this.devToolsUrl_ = undefined;
};

/** @return {boolean} */
BrowserLocalChrome.prototype.isRunning = function() {
  'use strict';
  return undefined !== this.childProcess_;
};

/** @return {string} WebDriver Server URL. */
BrowserLocalChrome.prototype.getServerUrl = function() {
  'use strict';
  return this.serverUrl_;
};

/** @return {string} DevTools URL. */
BrowserLocalChrome.prototype.getDevToolsUrl = function() {
  'use strict';
  return this.devToolsUrl_;
};

/** @return {Object} capabilities. */
BrowserLocalChrome.prototype.scheduleGetCapabilities = function() {
  'use strict';
  return this.app_.schedule('get capabilities', function() {
    return {
        webdriver: !!this.chromedriver_,
        'wkrdp.Page.captureScreenshot': true,
        'wkrdp.Network.clearBrowserCache': true,
        'wkrdp.Network.clearBrowserCookies': true
      };
  }.bind(this));
};

/**
 * Starts packet capture.
 *
 * #param {string} filename  local file where to copy the pcap result.
 */
BrowserLocalChrome.prototype.scheduleStartPacketCapture = function() {
  'use strict';
  throw new Error('Packet capture requested, but not implemented for Chrome');
};

/**
 * Stops packet capture and copies the result to a local file.
 */
BrowserLocalChrome.prototype.scheduleStopPacketCapture = function() {
  'use strict';
  throw new Error('Packet capture requested, but not implemented for Chrome');
};
