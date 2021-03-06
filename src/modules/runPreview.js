import mimeType from 'mime-types';
import marked from 'marked';
import fs from './utils/internalFs';
import helpers from './helpers';
import dialogs from '../components/dialogs';
import git from './git';
import PHP from './php';
import constants from '../constants';

function runPreview(isConsole = false, target = appSettings.value.previewMode) {
  const activeFile = isConsole ? null : editorManager.activeFile;

  let filename, path, extension;
  let port = constants.PORT;
  const HTML = mimeType.lookup('html');
  const decoder = new TextDecoder('utf-8');


  if (activeFile) {
    filename = activeFile.filename;
    path = activeFile.location;
    extension = helpers.getExt(filename);
  }

  if (extension === 'php') {
    if (!window.phpwarning) {
      dialogs.alert(strings.warning, strings.phpwarning, () => {
        start();
      });
      window.phpwarning = true;
    } else {
      start();
    }
  } else if (extension === 'js' && path) {
    for (let folderpath in addedFolder) {
      if (new RegExp("^" + encodeURI(path)).test(folderpath)) {
        window.resolveLocalFileSystemURL(path + 'index.html', onsuccess, onerror);
        return;
      }
    }
    onerror();
  } else {

    if (extension === 'js' || isConsole) {
      runConsole();
    }

    start();
  }

  function onsuccess() {
    dialogs.select('', [
      ['js', filename],
      ['html', 'index.html']
    ]).then(res => {
      if (res === 'js') {
        onerror();
      } else {
        filename = 'index.html';
        extension = 'html';
        start();
      }
    });
  }

  function onerror() {
    runConsole();
    start();
  }

  function runConsole() {
    isConsole = true;
    target = '_blank';
    filename = 'console.html';
    path = `${cordova.file.applicationDirectory}www`;
    port = constants.CONSOLE_PORT;
  }

  function start() {
    if (target === 'none' && extension !== 'js') {
      dialogs.select(strings['preview mode'], ['browser', 'in app'])
        .then(res => {
          target = res === 'browser' ? '_system' : '_blank';
          run();
        });
    } else {
      target = target === 'browser' ? '_system' : '_blank';
      run();
    }
  }


  function run() {
    webserver.stop();

    webserver.start(() => {
      openBrowser();
    }, err => {
      if (err === "Server already running") {
        openBrowser();
      } else {
        ++port;
        run();
      }
    }, port);
    webserver.onRequest(req => {
      let reqPath = req.path;

      if (reqPath === '/') {
        reqPath = '/index.html';
      }

      const assets = `${cordova.file.applicationDirectory}www`;
      const ext = helpers.getExt(reqPath);

      if (reqPath === '/_console.js') {
        const url = `${assets}/js/injection.build.js`;
        sendFileContent(url, req.requestId, 'application/javascript');
      } else if (reqPath === '/_esprisma.js') {
        const url = `${assets}/js/esprisma.js`;
        sendFileContent(url, req.requestId, 'application/javascript');
      } else if (reqPath === '/_codeflask.js') {
        const url = `${assets}/js/codeflask.min.js`;
        sendFileContent(url, req.requestId, 'application/javascript');
      } else if (reqPath === '/__script.js') {
        let text;
        if (extension === 'js') text = activeFile.session.getValue();
        else text = '';
        sendText(text, req.requestId, 'application/javascript');
      } else if (reqPath === '/_console.css') {
        const url = `${assets}/css/console.css`;
        sendFileContent(url, req.requestId, 'text/css');
      } else if (reqPath === '/_md.css') {
        const url = `${assets}/css/md.css`;
        sendFileContent(url, req.requestId, 'text/css');
      } else if (ext === 'php') {
        if (checkFile(reqPath)) { //is active file, unsaved or git
          const text = new PHP(activeFile.session.getValue(), {
            path
          }).vm.OUTPUT_BUFFER;
          sendHTML(text, req.requestId);
        } else {
          const url = path + reqPath;
          sendFileContent(url.replace('file://', ''), req.requestId, HTML, text => {
            return new PHP(text, {
              path
            }).vm.OUTPUT_BUFFER;
          });
        }
      } else if (ext === 'html') {
        if (isConsole) {
          const url = `${assets}/console.html`;
          sendFileContent(url, req.requestId, HTML);
        } else if (checkFile(reqPath)) {
          sendHTML(activeFile.session.getValue(), req.requestId);
        } else {
          sendFileContent(path + reqPath, req.requestId, HTML);
        }
      } else if (ext === 'md') {
        const html = marked(activeFile.session.getValue());
        const doc = `<!DOCTYPE html>
        <html lang="en">
        
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="X-UA-Compatible" content="ie=edge" />
          <link rel="stylesheet" href="/_md.css" />
          <title>${filename}</title>
        </head>
        
        <body>${html}</body>
        
        </html>`;
        sendText(doc, req.requestId, HTML);
      } else {
        if (activeFile && activeFile.type === 'git') {
          const uri = CACHE_STORAGE + activeFile.record.sha + encodeURIComponent(reqPath) + '.' + ext;

          window.resolveLocalFileSystemURL(uri, () => {
            sendFile(uri.replace('file://', ''), req.requestId);
          }, err => {
            if (err.code === 1) {
              git.getGitFile(activeFile.record, reqPath.slice(1))
                .then(res => {
                  const data = helpers.b64toBlob(res, mimeType.lookup(reqPath));
                  fs.writeFile(uri, data, true, false)
                    .then(() => {
                      sendFile(uri.replace('file://', ''), req.requestId);
                    })
                    .catch(err => {
                      if (err.code) dialogs.alert(strings.error, helpers.getErrorMessage(err.code));
                      console.log(err);
                    });
                })
                .catch(err => {
                  console.log(err);
                  error();
                });
            } else {
              error();
            }
          });
        } else {
          if (path) {
            const url = path + reqPath;
            const file = editorManager.getFile(url, "fileUri");
            if (file && file.isUnsaved) {
              sendText(file.session.getValue(), req.requestId, mimeType.lookup(file.filename));
            } else {
              sendFile(url.replace('file://', ''), req.requestId);
            }
          } else error();
        }
      }

      function error() {
        webserver.sendResponse(req.requestId, {
          status: 404
        });
      }
    });
  }


  /**
   * 
   * @param {string} text 
   * @param {string} id 
   */
  function sendHTML(text, id) {
    const js = `<meta name="viewport" content="width=device-width, initial-scale=1.0" /><script src="_console.js"></script><script src="_esprisma.js"></script><script src="_codeflask.js"></script><link rel="stylesheet" href="_console.css">`;
    text = text.replace(/><\/script>/g, 'crossorigin="anonymous"></script>');
    const part = text.split('<head>');
    if (part.length === 2) {
      text = `${part[0]}<head>${js}${part[1]}`;
    } else if (/<html>/i.test(text)) {
      text = text.replace('<html>', `<html><head>${js}</head>`);
    } else {
      text = `<head>${js}</head>` + text;
    }

    sendText(text, id);
  }

  function sendFile(path, id) {
    webserver.sendResponse(id, {
      status: 200,
      path,
      headers: {}
    });
  }

  function sendFileContent(url, id, mime, processText) {
    fs.readFile(url)
      .then(res => {
        let text = decoder.decode(res.data);
        text = processText ? processText(text) : text;
        if (mime === HTML) {
          sendHTML(text, id);
        } else {
          sendText(text, id, mime);
        }
      });
  }

  function sendText(text, id, mimeType, processText) {
    webserver.sendResponse(id, {
      status: 200,
      body: processText ? processText(text) : text,
      headers: {
        'Content-Type': mimeType || 'text/html'
      }
    });
  }

  function openBrowser() {

    let count = parseInt(localStorage.count);
    if (count < constants.RATING_TIME) {
      localStorage.count = ++count;
    }

    const theme = appSettings.value.appTheme;
    const themeColor = theme === 'default' ? '#9999ff' : theme === 'dark' ? '#313131' : '#ffffff';
    const color = theme === 'light' ? '#9999ff' : '#ffffff';
    const options = `background=${isConsole?'#313131':'#ffffff'},location=${isConsole?'no':'yes'},hideurlbar=yes,cleardata=yes,clearsessioncache=yes,hardwareback=yes,clearcache=yes,toolbarcolor=${themeColor},navigationbuttoncolor=${color},closebuttoncolor=${color},clearsessioncache=yes,zoom=no`;
    cordova.InAppBrowser.open(`http://localhost:${port}/` + filename, target, options);

  }

  function checkFile(reqPath) {
    if (!activeFile) return false;
    return reqPath === '/' + filename && (activeFile.isUnsaved || !activeFile.location || activeFile.type === 'git');
  }
}

export default runPreview;