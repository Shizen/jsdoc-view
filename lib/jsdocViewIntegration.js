
/**
 * @desc
 * Infrastructure to integrate vscode extension with webview.
 * @algorithm
 * This script is executed in every frame which gets opened in jsdocView.  The `window` is the current contentWindow
 * for that iframe.  Currently, I detect if I'm in the root frame or a subframe, and effectively do nothing in the
 * latter case.
 * `window.queuedSearch` only takes the last one to be queued, since otherwise it gets garbled.  
 * @notes
 * I can not do a `window.top.vscode === undefined` because iframes created in code by docstrap have no origin, and this counts as cross-origin access.
 * I also can not access `window.parent` for the same reason.
 * @remarks
 * This is very much an organicly grown file.  By and large it seems like its outlook is incorrect ;) and I should refactor to have fewer `!subframe`
 * references.
 * I currently have two deferred handshakes -- viewReady (which tells the extension that the panel can receive messages) and searchReady (which tells
 * the view itself that it has had its search iframe loaded).  The latter (`searchReady`) is *very* specific to how docstrap does searching.
 */

// console.log("`window` === `window.top`", window === window.top);
// console.log("`window.parent` === `window.top`", window.parent === window.top);
// if(window.parent) {
// 	console.log("parent's weakid: %s", window.parent.weakid !== undefined? window.parent.weakid : "none");
// }
// window.weakid = Math.random() * 20000;
// console.log(window.weakid);
// console.log(window);

var subframe = false;
try {	
	window.vscode = acquireVsCodeApi();
} catch(e) {
	// I'm in a subframe
	subframe = true;
}
// One could also just test `window.vscode !== undefined`
console.log("In a subframe? %s", subframe);


function ss_shim_gotoAnchor(_anchor) {
	$(document).ready(function() { 
		try {
			console.log("In iframe?", window.self !== window.top);
		} catch (e) {
			console.log("iframe test got error:", e);
		}

		try {
			$("a[name=" + _anchor + "]")[0].scrollIntoView();

			// Inflexible & bad "fix" for scrollIntoView miscalculations...
			// Move up by 50.
			// var y = $('#active-frame').contentWindow.scrollY;
			// console.log("no frame :/", $('#active-frame'));
			// console.log("no frame :/", document.getElementById("active-frame"));
			// console.log("so no contentWindow", $('#active-frame').contentWindow);
			console.log("window.self", window.self);
			console.log("window.top", window.top);
			console.log("window.self.scrollTop", window.self.scrollTop);
			console.log("window.top.scrollTop", window.top.scrollTop);
			console.log("window.self.scrollY", window.self.scrollY);
			console.log("window.top.scrollY", window.top.scrollY);
			var y = window.self.scrollY;
			console.log("y", y);
			y = Math.max(0, y - 65);
			console.log("y'", y);
			window.self.scrollTo(0, y);
			// console.log("document.parent", document.parent);
			// console.log("document.body", document.body);
			// console.log("document.body.scrollY", document.body.scrollY);
			// console.log("document.scrollTop", document.scrollTop);
			// console.log("document.body.scrollTop", document.body.scrollTop);
			// console.log("window.scrollTop", window.scrollTop);
			// console.log("No document.body.contentWindow", document.body.contentWindow);
			// var y = document.body.contentWindow.scrollY;
			// console.log("y", y);
			// y = Math.max(0, y - 50);
			// console.log("y'", y);
			// $('#active-frame').contentWindow.scrollTo(0, y);
			// document.scrollTo(0, y);
		} catch(e) {
			console.log("Tried to go to anchor `%s`, but received `%s`", _anchor, e.message, e);
		}
	});
}

/**
 * @desc
 * General onclick handler for this document.  This replaces the shim method I was using before.  This will cause any relative link clicked on to
 * cause the root webview to redirect to the requested url.  Currently this does not do any path protection (vscode enforces that already).
 * @remarks
 * This will not work in a subframe as it has no access to vscode.  There are various restrictions to accessing window.parent's values, but I can
 * at least call `postMessage` (I do not know the extent of the sandboxing).
 * This makes making shims obsolete.
 * @param {object} e 
 */
if(!subframe) {		// if (window.parent && window.parent.postMessage) <-- this is actually the opposite logic, to be clear
	document.onclick = function (e) {
		e = e ||  window.event;
		var element = e.target || e.srcElement;

		if (element.tagName == 'A') {
			var href = $(element).attr("href");
			// This is not robust -- What we are doing here is looking for relative links without a protocol/scheme
			if(href.length > 0 && href.indexOf(":") === -1) {
				window.vscode.postMessage({
					command: "navigate",
					text:href
				});
				return false;
			}
		}
	};
} else {
	// We could introduce a propogation technique if we had an example of such
}

// Again, the subframes never display anything...
if(!subframe) {
	window.addEventListener('message', function(event) {
		var message = event.data;

		// console.log("Received message with %s", JSON.stringify(event.data, null, " "));
		// switch(message.command)
		if(message.scrollTo) {
			ss_shim_gotoAnchor(message.scrollTo);
		} else if (message.search) {
			
			// console.log("Received search request (%s).  Ready? %s  (queued: %s)", message.search, window.searchReady, window.queuedSearch);
			if(window.searchReady) {
				// hax, docstrip specific
				$('iframe')[0].contentWindow.postMessage({ searchTerms: message.search, msgid: "docstrap.quicksearch.start" }, "*");
			} else {
				// console.log("Queueing...");
				window.queuedSearch = message.search;
			}
		}
	});
}

// This is only ever triggered currently from the root document for its subframes...
if(!subframe) {
	document.addEventListener("DOMContentLoaded", function() {		// $(document).ready()
		
		// Notify the extension that we are ready to receive messages
		window.vscode.postMessage({command: "viewReady"});

		$(window).load(function() {
			var el = $("iframe[src]");
			var src = [];
			el.each(function (_idx, _e) {
				var s = el.attr("src");
				if(src.indexOf(s) === -1) {
					window.vscode.postMessage({
						command: "loadUrl",
						text: el.attr("src")
					});
					src.push(s);
				}
			});

			// We could differentiate these messages by first, using a more guid() like mechanism to create `weakid`s
			// and then we could pass targetFrame weakid as part of messages to and from the server.
			window.addEventListener('message', function(event) {
				var message = event.data;
				if(message.iframeSrc) {
					var sel = "iframe[src='" + message.iframeSrc + "']";
					$(sel).attr("src", message.load);
					
					// [docstrap]: Now we are ready for searches and not before.
					console.log("Frame 'loaded', Ready? %s  (queued: %s)", window.searchReady, window.queuedSearch);
				}
			});
		});

		window.addEventListener("message", function(_event) {
			var message = _event.data;

			// console.log("Command listener Received %s", message);
			if(message.command && message.command === "viewReady") {
				// console.log("Received viewReady from child, assuming it is the search pane");
				window.searchReady = true;
				if(window.queuedSearch) {
					console.log("sent in queued search (%s)", window.queuedSearch);
					$('iframe')[0].contentWindow.postMessage({ searchTerms: window.queuedSearch, msgid: "docstrap.quicksearch.start" }, "*");
				}
			}
		});
	});
} else {
	// console.log("[child frame]: setting up listener");
	document.addEventListener("DOMContentLoaded", function() {		// $(document).ready()
		
		// console.log("[child frame]: sending viewReady");
		// Notify the extension that we are ready to receive messages
		window.parent.postMessage({command: "viewReady"}, "*");
	});
}