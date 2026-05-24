const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const fs = require('fs');
const path = require('path');

// دالة فك تشفير روابط الـ Base64
function decodeServerLink(rawLink) {
    try {
        let base64String = '';
        if (rawLink.includes('url=')) {
            base64String = rawLink.split('url=')[1];
        } else if (rawLink.includes('id=')) {
            base64String = rawLink.split('id=')[1];
        } else {
            return rawLink;
        }
        return Buffer.from(base64String, 'base64').toString('utf-8');
    } catch (e) {
        return rawLink;
    }
}

// دالة ذكية لإعطاء وزن/أولوية لكل سيرفر
function getServerPriority(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1;
    if (lowerUrl.includes('vidara')) return 2;
    if (lowerUrl.includes('voe')) return 3;
    return 4;
}

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح بوضع التخفي المتقدم...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
    });

    const page = await context.newPage();
    const screenshotDir = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
    }

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(6000);
        await page.screenshot({ path: path.join(screenshotDir, '1-homepage.png'), fullPage: true });
        console.log('📸 تم التقاط صورة الصفحة الرئيسية');
        
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(2000);

        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];
            movieElements.forEach((element) => {
                const linkElement = element.querySelector('a.movie__block');
                const titleElement = element.querySelector('h3');
                if (linkElement && titleElement) {
                    moviesData.push({
                        title: titleElement.textContent.trim(),
                        movie_url: linkElement.href
                    });
                }
            });
            return moviesData;
        });

        if (movies.length === 0) {
            console.log('⚠️ فشل استخراج الأفلام من الرئيسية بسبب جدار الحماية.');
            return;
        }

        const movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        
        let watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;
        movie.qualities = [];

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(screenshotDir, '2-movie-page.png'), fullPage: true });
        console.log('📸 تم التقاط صورة صفحة الفيلم');

        console.log('🎬 جاري الانتقال لصفحة المشاهدة...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار لتحميل قائمة الجودات والسيرفرات...');
        await page.waitForTimeout(7000);
        await page.screenshot({ path: path.join(screenshotDir, '3-watch-page.png'), fullPage: true });
        console.log('📸 تم التقاط صورة صفحة المشاهدة');

        // التحقق من وجود قائمة الجودات
        const qualitySwitcher = await page.$('.quality__swither');
        if (!qualitySwitcher) {
            console.log('❌ لم يتم العثور على محول الجودات');
            await page.screenshot({ path: path.join(screenshotDir, '4-no-quality-switcher.png'), fullPage: true });
            return;
        }

        // فتح قائمة الجودات المنسدلة
        console.log('🔽 جاري فتح قائمة الجودات المنسدلة...');
        await page.screenshot({ path: path.join(screenshotDir, '4-before-click-quality.png'), fullPage: true });
        
        // النقر على زر فتح القائمة
        try {
            await page.click('.quality__swither .title');
            console.log('✅ تم النقر على عنوان الجودة');
        } catch (e) {
            console.log('⚠️ فشل النقر على العنوان، جاري تجربة النقر على العنصر بالكامل...');
            await page.click('.quality__swither');
        }
        
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(screenshotDir, '5-quality-menu-opened.png'), fullPage: true });
        console.log('📸 تم التقاط صورة بعد فتح قائمة الجودات');

        // استخراج الجودات المتاحة
        const availableQualities = await page.evaluate(() => {
            const qualityElements = document.querySelectorAll('.qualities__list li');
            const qualities = [];
            qualityElements.forEach((li) => {
                const quality = li.getAttribute('data-quality');
                const title = li.getAttribute('data-title');
                if (quality) {
                    qualities.push({
                        quality: quality,
                        title: title || '',
                        isActive: li.classList.contains('active'),
                        isVisible: li.offsetParent !== null // التحقق من الظهور
                    });
                }
            });
            return qualities;
        });

        console.log(`📊 تم العثور على ${availableQualities.length} جودة: ${availableQualities.map(q => q.quality + 'p (visible: ' + q.isVisible + ')').join(', ')}`);

        // المرور على كل جودة واستخراج السيرفرات
        for (let i = 0; i < availableQualities.length; i++) {
            const qualityInfo = availableQualities[i];
            console.log(`\n🔄 جاري معالجة الجودة: ${qualityInfo.quality}p...`);

            // إذا لم تكن الجودة محددة مسبقاً، نختارها
            if (!qualityInfo.isActive) {
                // إعادة فتح القائمة إذا كانت مقفلة
                if (i > 0) {
                    console.log('   🔽 إعادة فتح قائمة الجودات...');
                    try {
                        await page.click('.quality__swither .title');
                        await page.waitForTimeout(1000);
                    } catch (e) {
                        console.log('   ⚠️ محاولة بديلة لفتح القائمة...');
                        await page.click('.quality__swither');
                        await page.waitForTimeout(1000);
                    }
                }

                console.log(`   👆 جاري اختيار الجودة ${qualityInfo.quality}p...`);
                await page.screenshot({ 
                    path: path.join(screenshotDir, `6-before-select-${qualityInfo.quality}p.png`), 
                    fullPage: true 
                });

                // تجربة طرق مختلفة للنقر
                try {
                    await page.click(`.qualities__list li[data-quality="${qualityInfo.quality}"]`);
                    console.log(`   ✅ تم النقر على الجودة ${qualityInfo.quality}p`);
                } catch (e) {
                    console.log(`   ⚠️ فشل النقر المباشر، جاري استخدام JavaScript...`);
                    await page.evaluate((quality) => {
                        const element = document.querySelector(`.qualities__list li[data-quality="${quality}"]`);
                        if (element) {
                            element.click();
                        }
                    }, qualityInfo.quality);
                }
                
                await page.waitForTimeout(3000);
                await page.screenshot({ 
                    path: path.join(screenshotDir, `7-after-select-${qualityInfo.quality}p.png`), 
                    fullPage: true 
                });
            }

            // كشط السيرفرات
            const rawServers = await page.evaluate(() => {
                const serverItems = document.querySelectorAll('.servers__list ul li');
                const extracted = [];
                serverItems.forEach((li) => {
                    const nameElement = li.querySelector('span');
                    const link = li.getAttribute('data-link');
                    if (link) {
                        extracted.push({
                            name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                            raw_link: link.trim(),
                            quality: li.getAttribute('data-qu') || 'unknown'
                        });
                    }
                });
                return extracted;
            });

            // تصفية وفك التشفير
            let processedServers = [];
            for (const srv of rawServers) {
                if (srv.name.includes('عرب سيد')) continue;
                const cleanIframeUrl = decodeServerLink(srv.raw_link);
                processedServers.push({
                    name: srv.name,
                    quality: srv.quality,
                    iframe_url: cleanIframeUrl,
                    priority: getServerPriority(cleanIframeUrl)
                });
            }

            processedServers.sort((a, b) => a.priority - b.priority);
            processedServers = processedServers.map((srv, index) => ({
                name: `سيرفر ${index + 1}`,
                quality: srv.quality,
                iframe_url: srv.iframe_url
            }));

            movie.qualities.push({
                quality: qualityInfo.quality + 'p',
                title: qualityInfo.title,
                servers_count: processedServers.length,
                servers: processedServers
            });

            console.log(`   ✅ تم استخراج ${processedServers.length} سيرفر للجودة ${qualityInfo.quality}p`);
        }

        // عرض ملخص النتائج
        console.log('\n📊 ملخص السيرفرات المستخرجة حسب الجودة:');
        movie.qualities.forEach(q => {
            console.log(`\n🎬 الجودة: ${q.quality} - ${q.servers_count} سيرفر`);
            q.servers.forEach(srv => {
                console.log(`   - ${srv.name}: ${srv.iframe_url.substring(0, 50)}...`);
            });
        });

        // حفظ النتائج
        fs.writeFileSync(
            path.join(process.cwd(), 'single_movie_result.json'), 
            JSON.stringify(movie, null, 2), 
            'utf-8'
        );
        console.log(`\n📁 تم حفظ الملف في: single_movie_result.json`);
        console.log(`📁 مجلد الصور: ${screenshotDir}`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
        await page.screenshot({ 
            path: path.join(screenshotDir, 'error-screenshot.png'), 
            fullPage: true 
        });
        console.log('📸 تم التقاط صورة لحالة الخطأ');
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
