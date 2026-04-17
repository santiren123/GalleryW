/**
 * cursor.js - Gallery W Global Magnetic Cursor
 */
document.addEventListener('DOMContentLoaded', () => {
    const dot = document.getElementById('cursor-dot');
    const viewfinder = document.getElementById('cursor-viewfinder');
    
    // 安全锁：移动端或元素不存在时直接退出，不消耗性能
    if (!dot || !viewfinder || window.innerWidth <= 768) return;

    let mouseX = 0, mouseY = 0;
    let dotX = 0, dotY = 0;     
    let vX = 0, vY = 0;         
    let isVisible = false; // 用于控制防闪烁

    window.addEventListener('mousemove', (e) => {
        // 首次移动鼠标时，初始化坐标并让光标浮现
        if (!isVisible) {
            dotX = vX = mouseX = e.clientX;
            dotY = vY = mouseY = e.clientY;
            dot.style.opacity = 1;
            viewfinder.style.opacity = 1;
            isVisible = true;
        } else {
            mouseX = e.clientX;
            mouseY = e.clientY;
        }

        // 悬停合焦侦测：兼容全站不同类型的卡片和按钮
        const target = e.target;
        const isHoverable = target.closest('a') || 
                            target.closest('button') || 
                            target.closest('.project-card') ||
                            target.closest('.photo-card') ||
                            target.closest('.tunnel-item');

        if (isHoverable) {
            viewfinder.classList.add('is-hovering');
        } else {
            viewfinder.classList.remove('is-hovering');
        }
    });

    function animateCursor() {
        if (isVisible) {
            // 圆点极速跟随
            dotX += (mouseX - dotX) * 0.2;
            dotY += (mouseY - dotY) * 0.2;
            dot.style.transform = `translate(${dotX}px, ${dotY}px)`;

            // 取景器带阻尼延迟
            vX += (mouseX - vX) * 0.1;
            vY += (mouseY - vY) * 0.1;
            viewfinder.style.transform = `translate(${vX}px, ${vY}px) translate(-50%, -50%)`;
        }
        requestAnimationFrame(animateCursor);
    }
    
    animateCursor();
});