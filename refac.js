

/**
 * @desc
 * Process the html provided to make it functional within the gimped environment of a vscode webview.
 * @algorithm
 * This function takes its direction from the configuration settings in `jsdocView.preprocessOptions.*`.
 * - Replace CSP
 * - Replace src attributes on `<script>` and `<a>` tags
 * - shim `<a>` tags
 * @remarks
 * Passing `_sHtml` on the stack is probably unwise for large files.  I deliberate how else I might want to deal.
 * I could use a global, with the potentialy messes that introduces to avoid copying on the stack.  I could roll 
 * reading of the file into this function.  I could box the string buffer and pass it that way, which is probably
 * what I should do.
 * How terrible is it that I pass the entire file on the stack?!?  I should really box it.  Look, I've even said
 * it twice.
 * @param {string} _sHtml A buffer with the sources to process.
 * @param {string} _extPath The path to this extension 
 * @param {string} _docPath "Optional", this is the path to the documentation this source comes from.  This
 * is used to resolve relative [file] path references and links in the source html.  If not provided, 
 * `preporcessHtml` will "guess" based on current settings.
 */
function preprocessHtml(_sHtml, _extPath, _docPath) {
  const $ = cheerio.load(_sHtml);
  const config = vscode.workspace.getConfiguration('jsdocView');

  // All of this made worse by path.posix.join/resolve/etc. not converting path delimeters properly (which it purports to do)
  let projectRootPath = vscode.workspace.rootPath;
  let drive = "";
  if(process.platform === "win32") {
    projectRootPath = projectRootPath.replace(/\\/g, "/");
    drive = projectRootPath.substring(0, projectRootPath.lastIndexOf(":")+1);
    projectRootPath = projectRootPath.substring(projectRootPath.lastIndexOf(":")+1);
  }

  // Derive best guess documentation directory if none provided.
  if(_docPath === undefined) {
    // Let's guess -- This will be replaced later by minimally a package.json check
    let docDir = config.get("docDir");
    _docPath = path.posix.join(projectRootPath, docDir);
  }

  
  //#region Helper functions
  // I could make a preprocess class/object and decorate it with these functions, or I could 
  // simply pull them out of here.  Only `normalizePath()` captures context.  Right now these are effectively
  // private functions of `preprocessHtml()`

  /**
   * @desc
   * This is a simple helper function that tests if a given url has a scheme or not.
   * @param {string} _url A url
   * @algorithm
   * This does a simple test for a ":" from the front like `^[\w-_]+:`.  I didn't look up the RFC, but afaik,
   * this will match only a scheme.  An authority would require `//`  before the `:`.
   * @notes
   * So I knew it would be wasteful, but it turns out its requirements cause it to be fail prima facia.
   * let url = new URL(_url, docDir);
   */
  function hasNoScheme(_url) {
    if(/^[\w-_]+:/.test(_url)) {
        return false;
    }
    return true;
  }

  /**
   * @desc
   * Currently, we read docs from disk.  Until we decide to serve them from an on-demand server, the policies of
   * vscode's webviewAPI require that we access local resources via the `vscode-resource:` scheme.  This helper
   * function will take a relative path and convert it to a fully resolved vscode-resource path.
   * @param {object} _el An element
   * @param {string} _sAttr The attribute containing a relative path to normalize
   */
  function normalizePath(_el, _sAttr) {
      let el = $(_el);
      let url = el.attr(_sAttr);

      // The trouble here is, relative to what, potentially.
      let p = path.posix.join(docPath, url);
      p = util.format("vscode-resource:/%s%s", drive, p);
      el.attr(_sAttr, p);
  }

  /**
   * @desc
   * This function replaces the `href` of an element with an onclick shim function to send a message to
   * the vscode "server" to navigate to the requested url.
   * @deprecated
   * These shims should no longer be necessary.  PreprocessHtml utilizes a broader reaching listener on 
   * the click process that looks for applicable hrefs on anchors and performs the same message passing
   * that this shim did.  In fact, I believe the shim has been removed from `jsdocViewIntegration.js`.
   * @remarks
   * At the moment, all shims are doc dir relative (and treated that way by the shim as well).
   * @param {object} _el 
   */
  function insertShim(_el) {
      let el = $(_el);
      // super fragile
      let ap = el.attr('href');
      // ap = path.posix.join(docDir, ap);
      // ap = ap.replace(/\\/g, "/");
      // let p = path.posix.relative(projectRootPath, ap);
      el.attr('href', null);
      el.attr("onclick", util.format("ss_shim_nav('%s')", ap));
  }

  //#endregion

  try {
    // Add in our integration "library"
    $('head').append(util.format('<script src="vscode-resource:/%s"></script>', path.join(_extPath, '/lib/jsdocViewIntegration.js').replace(/\\/g, "/")));

    // Content Security Policy
    if(config.get("preprocessOptions.replaceCSP")) {
      let policy = config.get("preprocessOptions.CSPolicy");
      //<meta http-equiv="Content-Security-Policy"
      let csp = $('meta[http-equiv=Content-Security-Policy]');
      if(csp.length >0) {
        csp.attr('content', policy);
      } else {
        policy = polcy.replace(/'/g, "\'");
        $('head').prepend(util.format('<meta http-equiv="Content-Security-Policy" content="%s">', policy));
        // $('head').prepend('<meta http-equiv="Content-Security-Policy" content="default-src vscode-resource: https: http: data:; img-src vscode-resource: https: http: data:; script-src \'unsafe-inline\' \'unsafe-eval\' vscode-resource: http:; style-src \'unsafe-inline\' vscode-resource: https: http:;">');
      }
    }

    // Process attributePath fixup
    // This walks the structure in the settings to do the fixup.  The old scheme basically hardcoded the defaults.
    if(config.get("preprocessOptions.fixAttributePaths")) {
      let fixupArray = config.get("preprocessOptions.fixAttributePaths2");
      fixupArray.forEach((_tag) => {
        let attrs = fixupArray[_tag].attrs;
        let inclFilter = fixupArray[_tag].ifHasClass;
        let exclFilter = fixupArray[_tag].exceptHasClass;

        attrs.forEach((_attr) => {
          let tag = _tag;
          if(attrs[_attr].tag !== undefined) {
            tag = attrs[_attr].tag;
          }
          let sel;
          if(attrs[_attr].selector !== undefined) {
            sel = util.format("%s[%s,%s]", tag, _attr, attrs[_attr].selector);
          } else {
            sel = util.format("%s[%s]", tag, _attr);
          }
          $(sel)
            .filter(function() {
              // Logically we're doing this...
              // let inc = true;
              // if(inclFilter) {
              //   inc = hasClass(this.attribs.class, inclFilter);
              // }
              // if(declFilter && hasClass(this.attribs.class, declFilter)) {
              //   inc = false;
              // }
              // But for perf reasons...
              let inc = inclFilter === undefined;
              let cls = this.attribs.class;
              for(let idx=0; idx < cls; idx++) {
                if(inclFilter.indexOf(cls[idx]) !== -1) {
                  inc = true;
                }
                if(declFilter.indexOf(cls[idx]) !== -1) {
                  return false;
                }
              }
              return inc;
            }).each((_idx, _el) => {
              if(hasNoScheme(_el.attribs[_attr])) {
                normalizePath(_el, _attr);
              }
            });
        });
      });
    }

    return $.html();

  } catch(e) {
    vscode.window.showErrorMessage("jsdocView encountered an error during preprocessing... (`%s`)", e.message);
  }
}