(function($) {
  // normally I wouldn't take a dependency on jQuery, but since it's already here...

  function toggleVisibility() {
    // Just punt marshalling string to boolean, really
    if($(this).attr("data-hide") === "true") {
      $(this).attr("data-hide", "false");
    } else {
      $(this).attr("data-hide", "true");
    }
  }

  $(".shinstrap-collapsible").click(toggleVisibility);
})(jQuery);