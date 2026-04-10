document.addEventListener('DOMContentLoaded', () => {
    const tunnel = document.getElementById('tunnel');
    const items = document.querySelectorAll('.tunnel-item');
    const ambientBg = document.getElementById('ambient-bg');
    const hero = document.querySelector('.hero-fixed');
    
    // Z轴推拉的系数：数字越大，滑得越快
    const zSpeed = 1.2; 
    
    // 动画帧请求变量，用于性能优化
    let ticking = false;
    let scrollY = 0;

    function updateScene() {
        // 1. 计算当前的 Z 轴推进距离
        const cameraZ = scrollY * zSpeed;
        
        // 推着整个隧道往脸上走
        tunnel.style.transform = `translateZ(${cameraZ}px)`;

        // 2. 处理首屏标题的消失 (推进 500px 后彻底隐去)
        const heroOpacity = Math.max(1 - (cameraZ / 500), 0);
        hero.style.opacity = heroOpacity;

        // 3. 计算每张照片与摄像机的距离，做精准的光影打击
        items.forEach(item => {
            // 获取在 HTML 里写的深度 (注意是负数)
            const itemZ = parseFloat(item.style.getPropertyValue('--z'));
            
            // 计算相对摄像机的距离 (大于0说明还在前面，小于0说明已经穿过了屏幕)
            const distance = itemZ + cameraZ;

            // --- 显隐逻辑 (极其重要，优化性能) ---
            // 距离大于 2000 的太远了，完全透明。
            // 距离穿过屏幕 (-500) 时，也完全透明。
            if (distance > 2500 || distance < -800) {
                item.style.opacity = 0;
                item.classList.remove('active');
            } else {
                // 进入可视范围，根据距离计算透明度，产生“从雾中浮现”的效果
                // 距离 2000 开始浮现，距离 1000 时完全清晰
                const opacity = Math.min(1, (2500 - distance) / 1500);
                // 穿过屏幕时迅速淡出
                const fadeOut = distance < 0 ? (1 + distance / 800) : 1;
                item.style.opacity = opacity * fadeOut;

                // --- 霓虹环境光打击逻辑 ---
                // 当照片推进到距离镜头 800px 到 -200px 这个黄金区间时，点亮环境光
                if (distance < 800 && distance > -200) {
                    item.classList.add('active'); // 照片自身的背光点亮
                    const color = item.getAttribute('data-color');
                    ambientBg.style.boxShadow = `inset 0 0 150px ${color}`; // 全局环境光晕染
                } else {
                    item.classList.remove('active');
                }
            }
        });

        ticking = false;
    }

    // 监听滚动事件，使用 requestAnimationFrame 保证 60fps 丝滑不卡顿
    window.addEventListener('scroll', () => {
        scrollY = window.scrollY;
        if (!ticking) {
            window.requestAnimationFrame(updateScene);
            ticking = true;
        }
    });

    // 初始渲染一次
    updateScene();
});