/**
 * cursor.js - Gallery W Global Magnetic Cursor & Glow Trail
 */
document.addEventListener('DOMContentLoaded', () => {
    const dot = document.getElementById('cursor-dot');
    const viewfinder = document.getElementById('cursor-viewfinder');
    
    // 安全锁：移动端或元素不存在时直接退出
    if (!dot || !viewfinder || window.innerWidth <= 768) return;

    // 💡 动态创建光晕容器，省去你改 HTML 的麻烦
    const trailContainer = document.createElement('div');
    trailContainer.className = 'glow-trail-container';
    document.body.appendChild(trailContainer);

    // 坐标与状态变量
    let mouseX = 0, mouseY = 0;
    let dotX = 0, dotY = 0;     
    let vX = 0, vY = 0;         
    let isVisible = false; 
    let lastParticleTime = 0;

    window.addEventListener('mousemove', (e) => {
        // 防闪烁初始化
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

        // 1. 悬停合焦侦测
        const target = e.target;
        const isHoverable = target.closest('a') || 
                            target.closest('button') || 
                            target.closest('.project-card') ||
                            target.closest('.photo-card') ||
                            target.closest('.manifesto-container') ||
                            target.closest('.tunnel-item');

        if (isHoverable) {
            viewfinder.classList.add('is-hovering');
        } else {
            viewfinder.classList.remove('is-hovering');
        }

        // 2. 释放光晕粒子 (控制频率：每 15ms 最多放一颗，防止卡顿)
        const currentTime = Date.now();
        if (currentTime - lastParticleTime > 15) {
            createParticle(mouseX, mouseY);
            lastParticleTime = currentTime;
        }
    });

    // 制造粒子的工厂函数
    function createParticle(x, y) {
        const particle = document.createElement('div');
        particle.classList.add('glow-particle');

        // 粒子大小：4px 到 12px 之间随机
        const size = Math.random() * 8 + 4;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;

        // 增加一点点随机的抖动偏移，让光晕看起来更自然
        const offsetX = (Math.random() - 0.5) * 8; 
        const offsetY = (Math.random() - 0.5) * 8;

        particle.style.left = `${x - size / 2 + offsetX}px`;
        particle.style.top = `${y - size / 2 + offsetY}px`;

        trailContainer.appendChild(particle);

        // 阅后即焚：800ms后动画结束，彻底删除节点释放内存
        setTimeout(() => {
            particle.remove();
        }, 800);
    }

    // 核心物理渲染循环
    function animateCursor() {
        if (isVisible) {
            // 圆点跟随
            dotX += (mouseX - dotX) * 0.2;
            dotY += (mouseY - dotY) * 0.2;
            dot.style.transform = `translate(${dotX}px, ${dotY}px)`;

            // 取景器带阻尼延迟跟随
            vX += (mouseX - vX) * 0.1;
            vY += (mouseY - vY) * 0.1;
            viewfinder.style.transform = `translate(${vX}px, ${vY}px) translate(-50%, -50%)`;
        }
        requestAnimationFrame(animateCursor);
    }
    
    animateCursor();
});