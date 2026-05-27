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

// دالة ذكية لإعطاء وزن/أولوية لكل سيرفر بناءً على نطاق الـ iframe
function getServerPriority(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1;
    if (lowerUrl.includes('vidara')) return 2; 
    if (lowerUrl.includes('voe')) return 3;    
    return 4;                                  
}

// دالة مخصصة لجمع وتصفية السيرفرات من الصفحة الحالية
async function extractAndProcessServers(page) {
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

    let processedServers = [];
    for (const srv of rawServers) {
        if (srv.name.includes('عرب سيد')) {
            continue; 
        }

        const cleanIframeUrl = decodeServerLink(srv.raw_link);
        
        processedServers.push({
            name: srv.name,
            quality: srv.quality,
            iframe_url: cleanIframeUrl,
            priority: getServerPriority(cleanIframeUrl)
        });
    }

    processedServers.sort((a, b) => a.priority - b.priority);

    return processedServers.map((srv, index) => ({
        name: `سيرفر ${index + 1}`,
        quality: srv.quality,
        iframe_url: srv.iframe_url
    }));
}

async function scrapeMovies() {
    console.log('🚀 جاري تشغيل المتصفح بوضع التخفي وتفعيل تسجيل الفيديو...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });

    const videoDir = path.join(process.cwd(), 'videos');
    if (!fs.existsSync(videoDir)){
        fs.mkdirSync(videoDir);
    }

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
        recordVideo: {
            dir: 'videos/',
            size: { width: 1920, height: 1080 }
        }
    });

    const page = await context.newPage();

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(6000);
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
        
        movie.extracted_data = {
            default_quality_servers: [],
            high_quality_servers: []
        };

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً لبناء جلسة موثوقة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('🎬 جاري الانتقال لصفحة المشاهدة وسيرفرات العرض...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار لفك شيفرة حاوية السيرفرات (الجودة الافتراضية)...');
        await page.waitForTimeout(7000);

        // 1. استخراج سيرفرات الجودة الافتراضية الأولى
        console.log('📊 استخراج سيرفرات الجودة الافتراضية أولاً...');
        const defaultServers = await extractAndProcessServers(page);
        movie.extracted_data.default_quality_servers = defaultServers;
        console.log(`✅ تم استخراج (${defaultServers.length}) سيرفر للجودة الافتراضية.`);

        // التقاط الروابط الخام الحالية قبل الضغط للمقارنة بها لاحقاً
        const oldLinks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.servers__list ul li')).map(li => li.getAttribute('data-link'));
        });

        // 2. منطق فتح قائمة الجودات والتحويل لأعلى جودة
        console.log('⚙️ جاري محاولة فتح قائمة الجودات وتحديد أعلى جودة...');
        const switcherSelector = '.quality__swither.full__767, .quality__swither';
        const isSwitcherVisible = await page.locator(switcherSelector).count();
        
        if (isSwitcherVisible > 0) {
            await page.click(switcherSelector);
            await page.waitForTimeout(1500);

            const targetQualityData = await page.evaluate(() => {
                const liElements = document.querySelectorAll('.qualities__list li');
                let highestQuality = -1;
                let selectorIndex = -1;

                liElements.forEach((li, index) => {
                    const qAttr = li.getAttribute('data-quality');
                    if (qAttr) {
                        const qNum = parseInt(qAttr, 10);
                        if (!isNaN(qNum) && qNum > highestQuality) {
                            highestQuality = qNum;
                            selectorIndex = index;
                        }
                    }
                });

                return { highestQuality, selectorIndex };
            });

            if (targetQualityData.selectorIndex !== -1 && targetQualityData.highestQuality > 0) {
                console.log(`🎯 أعلى جودة تم رصدها هي: ${targetQualityData.highestQuality}p. جاري النقر عليها...`);
                
                const qualityItems = page.locator('.qualities__list li');
                await qualityItems.nth(targetQualityData.selectorIndex).click();
                
                console.log('⏳ تم النقر. جاري مراقبة وتأكيد استبدال السيرفرات بالكامل...');

                // التعديل الجوهري والذكي: ننتظر برمجياً حتى تصبح الروابط داخل الـ li مختلفة تماماً عن الروابط القديمة
                try {
                    await page.waitForFunction((oldLinksArray) => {
                        const currentElements = document.querySelectorAll('.servers__list ul li');
                        if (currentElements.length === 0) return false;
                        
                        // التأكد من أن الصفحة لا تعرض كلمة "جاري التحميل" فقط
                        const containerText = document.querySelector('.servers__list')?.textContent || '';
                        if (containerText.includes('جاري التحميل')) return false;

                        const currentLinks = Array.from(currentElements).map(li => li.getAttribute('data-link'));
                        
                        // إذا كانت الروابط الحالية مطابقة تماماً للقديمة، هذا يعني أن الصفحة لم تتحدث بعد
                        if (currentLinks.length === oldLinksArray.length && currentLinks.every((val, i) => val === oldLinksArray[i])) {
                            return false; 
                        }
                        return true; // السيرفرات تغيرت والجديدة استقرت بالكامل
                    }, oldLinks, { timeout: 20000 });

                    // وقت أمان إضافي للتأكد من انتهاء أي معالجة جافا سكريبت بالخلفية
                    await page.waitForTimeout(4000);
                } catch (e) {
                    console.log('⚠️ لم يتم رصد تغير الروابط تلقائياً، سيتم الاعتماد على مهلة زمنية ثابتة قصوى.');
                    await page.waitForTimeout(10000);
                }

                // 3. إعادة استخراج السيرفرات الجديدة بعد التحويل والاستقرار
                console.log('📊 استخراج سيرفرات الجودة العالية الحالية...');
                const highServers = await extractAndProcessServers(page);
                movie.extracted_data.high_quality_servers = highServers;
                console.log(`✅ تم استخراج (${highServers.length}) سيرفر للجودة العالية الجديدة.`);
            } else {
                console.log('⚠️ لم يتم العثور على جودات متعددة صالحة داخل القائمة المنسدلة.');
            }
        } else {
            console.log('⚠️ لم يتم العثور على زر تبديل الجودات في هذه الصفحة.');
        }

        movie.servers = movie.extracted_data.high_quality_servers.length > 0 
            ? movie.extracted_data.high_quality_servers 
            : movie.extracted_data.default_quality_servers;

        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');
        console.log(`\n📁 تم حفظ ملف البيانات بنجاح: single_movie_result.json`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
    } finally {
        await context.close();
        await browser.close();
        console.log('🎬 تم إغلاق المتصفح وحفظ ملف الفيديو بنجاح.');
    }
}

scrapeMovies().catch(console.error);
