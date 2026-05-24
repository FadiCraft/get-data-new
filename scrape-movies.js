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

// دالة تحديد أولوية السيرفر (كلما قل الرقم زادت الأولوية)
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
            console.log('⚠️ فشل استخراج الأفلام من الرئيسية بسبب جدار الحماية.');
            return;
        }

        const movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        
        let watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;
        movie.servers = [];

        console.log('🔄 جاري التوجه لصفحة الفيلم الرئيسية أولاً لبناء جلسة موثوقة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('🎬 جاري الانتقال الآمن لصفحة المشاهدة وسيرفرات العرض...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await page.evaluate(() => window.scrollBy(0, 500));
        console.log('⏳ انتظار استقرار عناصر الصفحة والـ HTML...');
        await page.waitForTimeout(6000);

        // --- ميكانيكية التنقل بين الجودات واستخراج السيرفرات ---
        
        // 1. استخراج الجودات المتاحة في الصفحة (الـ Selectors الخاصة بـ li)
        const qualitySelectors = await page.evaluate(() => {
            const listItems = document.querySelectorAll('.quality__swither ul.qualities__list li');
            const qualities = [];
            listItems.forEach((li, index) => {
                const qValue = li.getAttribute('data-quality') || li.querySelector('.qu')?.textContent.trim();
                if (qValue) {
                    qualities.push({
                        index: index, // سنستخدم المؤشر للضغط بدقة
                        quality_name: qValue + 'p'
                    });
                }
            });
            return qualities;
        });

        console.log(`📊 الجودات المكتشفة في الصفحة:`, qualitySelectors.map(q => q.quality_name));

        let allExtractedServers = [];

        // إذا لم يجد مصفف جودات (تحوطاً)، نأخذ السيرفرات الظاهرة مباشرة
        if (qualitySelectors.length === 0) {
            console.log('ℹ️ لم يتم العثور على أداة تبديل الجودات، سيتم كشط الجودة الافتراضية المتاحة فقط.');
            allExtractedServers = await extractCurrentVisibleServers(page, 'الافتراضية');
        } else {
            // 2. المرور على كل جودة، الضغط عليها، ثم كشط سيرفراتها
            for (const q of qualitySelectors) {
                console.log(`🔄 جاري التبديل إلى الجودة: [${q.quality_name}]...`);
                
                try {
                    // الضغط على عنصر الجودة بناءً على ترتيبه في الصفحة
                    await page.evaluate((idx) => {
                        const items = document.querySelectorAll('.quality__swither ul.qualities__list li');
                        if (items[idx]) items[idx].click();
                    }, q.index);
                    
                    // انتظار قصير جداً لتحديث السيرفرات في الـ DOM بعد الضغط
                    await page.waitForTimeout(1500);

                    // كشط السيرفرات الحالية المتأثرة بالضغطة
                    const serversForThisQuality = await extractCurrentVisibleServers(page, q.quality_name);
                    allExtractedServers = allExtractedServers.concat(serversForThisQuality);

                } catch (clickError) {
                    console.error(`❌ تعذر الضغط على الجودة ${q.quality_name}:`, clickError.message);
                }
            }
        }

        // 3. التصفية النهائية: استبعاد سيرفر عرب سيد والترتيب حسب الأولوية
        let filteredServers = allExtractedServers.filter(srv => !srv.name.includes('عرب سيد'));

        // الترتيب بحسب دالة الأولوية (Priority)
        filteredServers.sort((a, b) => a.priority - b.priority);

        // 4. إعادة صياغة الأسماء والترقيم النهائي مع الحفاظ على حقل الجودة المستخرجة لكل سيرفر
        const finalSortedServers = filteredServers.map((srv, index) => {
            return {
                name: `سيرفر ${index + 1}`,
                quality: srv.quality,
                iframe_url: srv.iframe_url
            };
        });

        movie.servers = finalSortedServers;

        if (finalSortedServers.length > 0) {
            console.log(`\n🎉 انتصار كامل! تم تجميع وترتيب ${finalSortedServers.length} سيرفر لكافة الجودات معاً:`);
            console.log(JSON.stringify(finalSortedServers, null, 2));
        } else {
            console.log('⚠️ لم يتم العثور على سيرفرات صالحة بعد دمج الجودات.');
        }

        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');
        console.log(`\n📁 تم حفظ البيانات لجميع الجودات بنجاح في: single_movie_result.json`);

    } catch (error) {
        console.error('❌ حدث خطأ غير متوقع:', error);
    } finally {
        await browser.close();
    }
}

// دالة مساعدة لكشط السيرفرات المرئية حالياً في الصفحة
async function extractCurrentVisibleServers(page, currentQualityName) {
    return await page.evaluate((qualityLabel) => {
        const serverItems = document.querySelectorAll('.servers__list ul li');
        const extracted = [];
        
        // دالة داخلية لفك الـ Base64 داخل سياق المتصفح (btoa / atob)
        function decodeInsideBrowser(rawLink) {
            try {
                let base64String = '';
                if (rawLink.includes('url=')) base64String = rawLink.split('url=')[1];
                else if (rawLink.includes('id=')) base64String = rawLink.split('id=')[1];
                else return rawLink;
                return atob(base64String); // fف التشفير في المتصفح باستخدام atob
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
            const dataQu = li.getAttribute('data-qu'); // قراءة جودة السيرفر نفسه إن وجدت
            
            if (link) {
                const cleanIframeUrl = decodeInsideBrowser(link.trim());
                extracted.push({
                    name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                    quality: dataQu ? dataQu + 'p' : qualityLabel, // إذا لم تكن موجودة، نعتمد جودة التبويب الحالي
                    iframe_url: cleanIframeUrl,
                    priority: getPriorityInsideBrowser(cleanIframeUrl)
                });
            }
        });
        return extracted;
    }, currentQualityName);
}

scrapeMovies().catch(console.error);
