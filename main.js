(function () {
  var grid = document.getElementById("grid");
  var squareCount = 9;

  Array.from({ length: squareCount }).forEach(function () {
    var tile = document.createElement("div");
    tile.className = "tile";
    grid.appendChild(tile);
  });
})();
