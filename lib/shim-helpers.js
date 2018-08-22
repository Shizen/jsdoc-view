
if(vscode === undefined) {	
	try {
		var vscode = acquireVsCodeApi();
	} catch(e) {
		console.log("window %s is not window.self %s (%s)", window, window.self, window.top);
		console.log("iframe doesn't have access to vscode `%s`", e.message);
	}

	function ss_shim_nav(_url) {
		vscode.postMessage({
			command: "navigate",
			text:_url
		});
	}

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

	// This makes making shims obsolete.
	document.onclick = function (e) {
		e = e ||  window.event;
		var element = e.target || e.srcElement;
	
		if (element.tagName == 'A') {
			var href = $(element).attr("href");
			// This is not robust -- What we are doing here is looking for relative links without a protocol/scheme
			if(href.length > 0 && href.indexOf(":") === -1) {
				vscode.postMessage({
					command: "navigate",
					text:href
				});
				return false;
			}
		}
	};

	window.addEventListener('message', function(event) {
		const message = event.data;

		console.log("Received message with %s", JSON.stringify(event.data, null, " "));

		if(message.scrollTo) {
			ss_shim_gotoAnchor(message.scrollTo);
		} else if (message.search) {
			// hax, docstrip specific
			$('iframe')[0].contentWindow.postMessage({ searchTerms: message.search, msgid: "docstrap.quicksearch.start" }, "*");
		}
	});

	document.addEventListener("DOMContentLoaded", function() {
		$(window).load(function() {
			var el = $("iframe[src]");
			el.each(function (_idx, _e) {
				vscode.postMessage({
					command: "loadUrl",
					text: el.attr("src")
				});
			});

			window.addEventListener('message', function(event) {
				var message = event.data;
				if(message.iframeSrc) {
					var sel = "iframe[src='" + message.iframeSrc + "']";
					$(sel).attr("src", message.load);
				}
			});
			// test
			// $("iframe[src='quicksearch.html']").attr("src", "vscode-resource:/p:/ROI/_Modules/shin-grunt-build-tasks/docs/quicksearch.html");
			// vscode-resource:/p:/Experimental/VSCode/jsdoc-view/lib/shim-helpers.js
			//vscode-resource:/p:/ROI/_Modules/shin-grunt-build-tasks/docs/styles/site.lumen.css
		});
	});
} else {
	console.log("window %s is not window.self %s (%s)", window, window.self, window.top);
}