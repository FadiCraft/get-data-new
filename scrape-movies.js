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

// دالة تحديد أولوية السيرفر
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

    // صفحة استكشاف أولية للحصول على بيانات الفيلم ورابط المشاهدة
    const initPage = await context.newPage();
    let movie = {};
    let watchUrl = '';

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية للاستكشاف...');
        await initPage.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await initPage.waitForTimeout(6000);
        
        const movies = await initPage.evaluate(() => {
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
            console.log('⚠️ فشل استخراج الأفلام من الرئيسية.');
            await browser.close();
            return;
        }

        movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;

    } catch (err) {
        console.error('❌ خطأ في الاستكشاف الأولي:', err.message);
        await browser.close();
        return;
    } finally {
        await initPage.close(); // نغلق صفحة الاستكشاف لنبدأ صفحات نظيفة للجودات
    }

    // المصفوفة الثابتة للجودات التي نريد فحصها بشكل مستقل ومضمون
    const targetQualities = [
        { name: '480p', index: 0 },
        { name: '720p', index: 1 },
        { name: '1080p', index: 2 }
    ];

    let allExtractedServers = [];

    // الحيلة الجديدة: نفتح صفحة منفصلة تماماً من الصفر لكل جودة!
    for (const q of targetQualities) {
        console.log(`\n🎬 --- بدء دورة فحص مستقلة كاملة لجودة [${q.name}] ---`);
        const page = await context.newPage();

        try {
            console.log(`🔄 [${q.name}] 1. بناء الجلسة الموثوقة بدخول صفحة الفيلم...`);
            await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(4000);

            console.log(`🔄 [${q.name}] 2. الانتقال المباشر لصفحة المشاهدة...`);
            await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.evaluate(() => window.scrollBy(0, 500));
            await page.waitForTimeout(5000); // انتظار استقرار الحاوية الافتراضية

            console.log(`🔄 [${q.name}] 3. فتح القائمة المنسدلة والضغط على الجودة...`);
            // فتح القائمة المنسدلة
            const switcherExists = await page.evaluate(() => !!document.querySelector('.quality__swither .title'));
            if (switcherExists) {
                await page.click('.quality__swither .title', { timeout: 5000 });
                await page.waitForTimeout(1000);

                // النقر على الجودة المحددة لهذه الدورة
                const liSelector = `.quality__swither ul.qualities__list li:nth-child(${q.index + 1})`;
                await page.click(liSelector, { force: true });
                console.log(`⏳ [${q.name}] انتظار 5 ثوانٍ لتمكين الموقع من حقن سيرفرات الجودة الجديدة...`);
                await page.waitForTimeout(5000);
            } else {
                console.log(`ℹ️ [${q.name}] لم يتم العثور على أداة تبديل، سيتم كشط المتوفر مباشرة.`);
            }

            // كشط السيرفرات الناتجة عن هذه الدورة النظيفة
            const serversForThisQuality = await extractCurrentVisibleServers(page, q.name);
            console.log(`⚡ [${q.name}] تم كشط ${serversForThisQuality.length} سيرفر بنجاح!`);
            
            allExtractedServers = allExtractedServers.concat(serversForThisQuality);

        } catch (loopError) {
            console.error(`❌ خطأ أثناء معالجة دورة جودة ${q.name}:`, loopError.message);
        } finally {
            await page.close(); // إغلاق الصفحة تماماً لتنظيف الذاكرة والجلسة للدورة القادمة
        }
    }

    // 3. التنظيف النهائي ومنع التكرار (رابط + جودة)
    let uniqueServersMap = new Map();
    for (const srv of allExtractedServers) {
        if (srv.name.includes('عرب سيد')) continue; // استبعاد عرب سيد
        
        const uniqueKey = `${srv.iframe_url}_${srv.quality}`;
        if (!uniqueServersMap.has(uniqueKey)) {
            uniqueServersMap.set(uniqueKey, srv);
        }
    }

    let filteredServers = Array.from(uniqueServersMap.values());

    // الترتيب حسب الأولوية لتطبيقك
    filteredServers.sort((a, b) => a.priority - b.priority);

    // إعادة الصياغة والترقيم النهائي
    const finalSortedServers = filteredServers.map((srv, index) => {
        return {
            name: `سيرفر ${index + 1}`,
            quality: srv.quality,
            iframe_url: srv.iframe_url
        };
    });

    movie.servers = finalSortedServers;

    if (finalSortedServers.length > 0) {
        console.log(`\n🎉 انتصار ساحق ومكتمل! إجمالي السيرفرات المستخرجة والمفرزة لكل الجودات: ${finalSortedServers.length}`);
        console.log(JSON.stringify(finalSortedServers, null, 2));
    } else {
        console.log('⚠️ لم يتم العثور على أي سيرفرات صالحة في كافة الدورات.');
    }

    fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');
    console.log(`\n📁 تم حفظ ملف البيانات المحدث والجاهز للاستخدام في: single_movie_result.json`);

    await browser.close();
}

// دالة الكشط وفك التشفير داخل المتصفح
async function extractCurrentVisibleServers(page, qualityLabel) {
    return await page.evaluate((enforcedQuality) => {
        const serverItems = document.querySelectorAll('.servers__list ul li');
        const extracted = [];
        
        function decodeInsideBrowser(rawLink) {
            try {
                let base64String = '';
                if (rawLink.includes('url=')) base64String = rawLink.split('url=')[1];
                else if (rawLink.includes('id=')) base64String = rawLink.split('id=')[1];
                else return rawLink;
                return atob(base64String); 
            } catch (e) {
                return rawLink;
            }
        }

        function getPriorityInsideBrowser(url) {
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('vidmoly')) return 1;
            if (lowerUrl.includes('vidara')) return 2;
            if (lowerUrl.includes('voe')) return 3;
            return 4;
        }

        serverItems.forEach((li) => {
            const nameElement = li.querySelector('span');
            const link = li.getAttribute('data-link');
            
            if (link) {
                const cleanIframeUrl = decodeInsideBrowser(link.trim());
                extracted.push({
                    name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                    quality: enforcedQuality, 
                    iframe_url: cleanIframeUrl,
                    priority: getPriorityInsideBrowser(cleanIframeUrl)
                });
            }
        });
        return extracted;
    }, qualityLabel);
}

scrapeMovies().catch(console.error);
