
# Notes

- Look at the search document and why it doesn't display;  try to get it to emit to console the data it would have produced in its iframe (that's my recollection of how it works), and see if we can either get the iframe to work or replace that iframe with a div or some such...
- Setup sending a message from vscode to the webview when there has been a contextual lookup, to trigger a search in the page.
  - Encapsulate the triggering of this search to allow for shifting of the webview to look at the right jsdocs (this is basically free).

## Anchors & Gotos

We can within an iframe grab an element and `scrollIntoView()` it.

		$("a[name=" + _anchor + "]")[0].scrollIntoView();

I also know, at least for docstrap, that it has a lib which on opening a source file sets a specific anchor pattern for each source line therein.  This is *probably* a jsdoc convention, and not specific to docstrap.

  $('#active-frame').contentWindow.scrollTo(0,300)
  $('#active-frame').contentWindow.scrollY

Works, but only from the context of the debugger, which is working from a global context.  In `shim-helpers.js`, we have a different scope of access.  There we need to use `window.self`.  If defined, this is the `contentWindow` for the current document.  `window.top` is the root `window`.  If undefined there is only one `window`.  I'm not sure if all the browsers use this pattern, but it holds for the webkit used by atom/electron/vscode.  Thus...

  window.self.scrollY
  window.self.scrollTo(0, 300)