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
            console.log('⚠️ فشل استخراج الأفلام من الرئيسية.');
            return;
        }

        const movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        
        let watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية لبناء جلسة موثوقة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('🎬 جاري الانتقال لصفحة المشاهدة وسيرفرات العرض...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار استقرار عناصر الصفحة والـ HTML الأصلية...');
        await page.waitForTimeout(6000);

        // خطوة أمان ذكية: كشط السيرفرات الظاهرة حالياً فوراً قبل اللعب بأزرار الجودات
        console.log('📥 كشط السيرفرات النشطة افتراضياً في الصفحة أولاً...');
        let allExtractedServers = await extractCurrentVisibleServers(page, 'افتراضية');
        console.log(`⚡ تم كشط ${allExtractedServers.length} سيرفر من الوضع الافتراضي.`);

        // 1. استخراج الجودات المتاحة
        const qualitySelectors = await page.evaluate(() => {
            const listItems = document.querySelectorAll('.quality__swither ul.qualities__list li');
            const qualities = [];
            listItems.forEach((li, index) => {
                const qValue = li.getAttribute('data-quality') || li.querySelector('.qu')?.textContent.trim();
                if (qValue) {
                    qualities.push({
                        index: index,
                        quality_name: qValue.includes('p') ? qValue : qValue + 'p'
                    });
                }
            });
            return qualities;
        });

        console.log(`\n📊 الجودات المكتشفة في القائمة المنسدلة:`, qualitySelectors.map(q => q.quality_name));

        // 2. التنقل الهادئ بين الجودات الأخرى
        for (const q of qualitySelectors) {
            console.log(`🔄 جاري تبديل الجودة إلى: [${q.quality_name}]...`);
            
            try {
                // فتح القائمة المنسدلة أولاً بشكل صريح
                await page.click('.quality__swither .title', { timeout: 5000 });
                await page.waitForTimeout(1000); // إعطاء القائمة فرصة للظهور بصرياً

                // الضغط على الخيار المحدد قسرياً باستخدام محاكي النقر لـ Playwright لضمان تنفيذ حدث المتصفح بالكامل
                const liSelector = `.quality__swither ul.qualities__list li:nth-child(${q.index + 1})`;
                await page.click(liSelector, { force: true });
                
                // انتظار تصفية الـ AJAX من الموقع لتغيير محتوى السيرفرات
                await page.waitForTimeout(3500);

                // كشط سيرفرات الجودة الحالية
                const serversForThisQuality = await extractCurrentVisibleServers(page, q.quality_name);
                console.log(`⚡ تم كشط ${serversForThisQuality.length} سيرفر متوافق مع جودة [${q.quality_name}].`);
                
                allExtractedServers = allExtractedServers.concat(serversForThisQuality);

            } catch (clickError) {
                console.error(`❌ خطأ تكتيكي أثناء التحويل لجودة ${q.quality_name}:`, clickError.message);
            }
        }

        // 3. التصفية والتنظيف النهائي وإزالة التكرار (منع تكرار نفس رابط الـ iframe)
        let uniqueServersMap = new Map();
        
        for (const srv of allExtractedServers) {
            if (srv.name.includes('عرب سيد')) continue; // استبعاد عرب سيد
            
            // نستخدم رابط الـ iframe كمعرّف فريد لمنع تكرار السيرفرات المتطابقة عبر الجودات
            if (!uniqueServersMap.has(srv.iframe_url)) {
                uniqueServersMap.set(srv.iframe_url, srv);
            }
        }

        let filteredServers = Array.from(uniqueServersMap.values());

        // الترتيب بحسب دالة الأولوية (Priority)
        filteredServers.sort((a, b) => a.priority - b.priority);

        // 4. بناء المصفوفة النهائية المرقمة لتقديمها لتطبيقك
        const finalSortedServers = filteredServers.map((srv, index) => {
            return {
                name: `سيرفر ${index + 1}`,
                quality: srv.quality,
                iframe_url: srv.iframe_url
            };
        });

        movie.servers = finalSortedServers;

        if (finalSortedServers.length > 0) {
            console.log(`\n🎉 انتصار حقيقي ومكتمل! إجمالي السيرفرات المستخرجة والمفرزة بنجاح: ${finalSortedServers.length}`);
            console.log(JSON.stringify(finalSortedServers, null, 2));
        } else {
            console.log('⚠️ فشل المتصفح تماماً في العثور على أي سيرفرات.');
            await page.screenshot({ path: 'dropdown-critical-debug.png', fullPage: true });
        }

        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');
        console.log(`\n📁 تم حفظ البيانات النهائية النظيفة في: single_movie_result.json`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
    } finally {
        await browser.close();
    }
}

async function extractCurrentVisibleServers(page, qualityLabel) {
    return await page.evaluate((label) => {
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
            const dataQu = li.getAttribute('data-qu'); 
            
            if (link) {
                const cleanIframeUrl = decodeInsideBrowser(link.trim());
                extracted.push({
                    name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                    quality: dataQu ? dataQu + 'p' : label, 
                    iframe_url: cleanIframeUrl,
                    priority: getPriorityInsideBrowser(cleanIframeUrl)
                });
            }
        });
        return extracted;
    }, qualityLabel);
}

scrapeMovies().catch(console.error);
