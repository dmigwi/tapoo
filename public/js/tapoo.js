function drawGrid(context, startWidth, startHeight) {
    for (var x = 0.5; x < 1001; x += 20) {
      context.moveTo(x, startWidth);
      context.lineTo(x, 1000);
    }
    
    for (var y = 0.5; y < 1001; y += 20) {
      context.moveTo(startHeight, y);
      context.lineTo(1000, y);
    }
    
    context.strokeStyle = "#53d80f";
    context.stroke();
}

function init() {
    const playground = document.getElementById('data-playground')
    const ctx = playground.getContext('2d')
    const headerHeight = window.innerHeight * 0.05
    const footerHeight = window.innerHeight * 0.05
    const height = window.innerHeight - (headerHeight + footerHeight);
    const width = window.innerWidth;
    
    ctx.canvas.height = height
    ctx.canvas.width = width
    ctx.fillStyle = '#53d80f';
    drawGrid(ctx, headerHeight, headerHeight)
}

window.onload = function () {
    init();
    window.addEventListener("resize", init, false);
}
