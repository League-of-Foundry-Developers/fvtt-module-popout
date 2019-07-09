class Popout {
    static onRenderJournalSheet(obj, html, data) {
	let share_image = html.find(".share-image")
	// Not a GM
	if (share_image.length == 0) {
	    return;
	}
	let popout = $('<a class="popout" style><i class="fas fa-external-link-alt"></i>PopOut!</a>')
	popout.on('click', Popout.onPopoutClicked)
	popout.insertBefore(share_image)
	
    }
    static onPopoutClicked(event) {
	let div = $(event.target).closest("div")
	let window_title = div.find(".window-title").text().trim()

	// Create a new html document
	let html = $("<html>")
	let head = $("<head>")
	let body = $("<body>")

	// Copy classes from html/head/body tags and add title
	html.attr("class", $("html").attr("class"))
	head.attr("class", $("head").attr("class"))
	head.append($("<title>" + window_title + "</title>"))
	body.attr("class", $("body").attr("class"))
	// Clone the journal sheet so we can modify it safely
	div = div.clone()
	// Remove the buttons and forms because there are no JS hooks into them.
	div.find("header a,form button,form .form-group,.window-resizable-handle").remove()
	// Make sure any newly opened item doesn't get hidden behind it and set the size to the full window - padding.
	div.css({"z-index": "0",
		 "width": "100%",
		 "height": "100%",
		 "top": "0",
		 "left": "0",
		 "padding": "15px",
		})
	body.append(div)
	html.append(head)
	html.append(body)
	// Still can't open images to background since they are set as css background instead of <img src> :@
	let prevent_contextmenu = `
	document.superListener = document.addEventListener;
	document.addEventListener = function(type, listener, useCapture){
	    if(type != 'contextmenu')
		document.superListener(type, listener, !!useCapture);
	};
	`
	// Doesn't seem to work
	let prevent_resize = `
	window.superListener = window.addEventListener;
	window.addEventListener = function(type, listener, useCapture){
	    if(type != 'resize')
		window.superListener(type, listener, !!useCapture);
	};
	`
	head.append($("<script>" + prevent_contextmenu + "</script>"))
	head.append($("<script>" + prevent_resize + "</script>"))

	// Copy the scripts and css so the sheet appears correctly
	for (let link of $("head link")) {
	    let new_link = $(link).clone()
	    // Replace the href with the full URL
	    if (new_link.href != "")
		new_link.attr("href", link.href)
	    head.append(new_link)
	}
	for (let script of $("head script,body script")) {
	    let new_script = $(script).clone()
	    // Replace the src with the full URL
	    if (script.src != "")
		new_script.attr("src", script.src)
	    head.append(new_script)
	}

	// Open new window and write the new html document into it
	let win = window.open()
	console.log(win)
	// This is for electron which doesn't have a Window but a BrowserWindowProxy
	if (win.document == undefined) {
	    win.eval('document.write(\`' + html[0].outerHTML + '\`)')
	} else {
	    win.document.write(html[0].outerHTML)
	}
    }
}

Hooks.on('renderJournalSheet', Popout.onRenderJournalSheet)
