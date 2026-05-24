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

// دالة تحديد أولوية السيرفر (Vidmoly -> Vidara -> Voe)
function getServerPriority(url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('vidmoly')) return 1;
    if (lowerUrl.includes('vidara')) return 2;
    if (lowerUrl.includes('voe')) return 3;
    return 4;
}

async function scrapeMovies() {
    console.log('🚀 [GitHub Actions] تشغيل المتصفح في وضع الحاوية...');
    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'ar-SA',
    });

    const page = await context.newPage();

    try {
        console.log('🔄 جاري فتح الصفحة الرئيسية...');
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(6000);

        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];
            movieElements.forEach((element) => {
                const linkElement = element.querySelector('a.movie__block');
                const titleElement = element.querySelector('h3');
                if (linkElement && titleElement) {
                    moviesData.push({ title: titleElement.textContent.trim(), movie_url: linkElement.href });
                }
            });
            return moviesData;
        });

        if (movies.length === 0) {
            console.log('⚠️ فشل استخراج الأفلام.');
            return;
        }

        const movie = movies[0];
        console.log(`\n🎯 الفيلم المستهدف: ${movie.title}`);
        let watchUrl = movie.movie_url.endsWith('/') ? movie.movie_url + 'watch/' : movie.movie_url + '/watch/';
        movie.watch_url = watchUrl;

        console.log('🔄 بناء الجلسة الآمنة...');
        await page.goto(movie.movie_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(4000);

        console.log('🎬 الانتقال لصفحة المشاهدة وسحب الـ DOM بالكامل...');
        await page.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(7000); // وقت كافٍ للموقع لحقن كل السيرفرات في الخلفية

        // القشط الشامل: سحب كل عنصر li يحتوي على data-link في الصفحة بغض النظر عن الجودة الظاهرة
        const rawServers = await page.evaluate(() => {
            const serverItems = document.querySelectorAll('.servers__list ul li, [data-link]');
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
                const link = li.getAttribute('data-link');
                const nameElement = li.querySelector('span') || li;
                let dataQu = li.getAttribute('data-qu') || '480'; // إذا لم يجد جودة صريحة يضع الافتراضية
                
                if (link) {
                    const cleanIframeUrl = decodeInsideBrowser(link.trim());
                    extracted.push({
                        name: nameElement ? nameElement.textContent.trim() : 'سيرفر مشاهدة',
                        quality: dataQu.includes('p') ? dataQu : dataQu + 'p',
                        iframe_url: cleanIframeUrl,
                        priority: getPriorityInsideBrowser(cleanIframeUrl)
                    });
                }
            });
            return extracted;
        });

        console.log(`⚡ [GitHub Actions] تم العثور على ${rawServers.length} عنصر خام في الـ HTML.`);

        // تصفية السيرفرات ومنع التكرار المطلق (بناءً على رابط الـ iframe)
        let uniqueServersMap = new Map();
        for (const srv of rawServers) {
            if (srv.name.includes('عرب سيد')) continue; // استبعاد عرب سيد
            
            if (!uniqueServersMap.has(srv.iframe_url)) {
                uniqueServersMap.set(srv.iframe_url, srv);
            }
        }

        let filteredServers = Array.from(uniqueServersMap.values());
        
        // الترتيب حسب الأولوية للتطبيق
        filteredServers.sort((a, b) => a.priority - b.priority);

        // إعادة الصياغة والترقيم
        const finalSortedServers = filteredServers.map((srv, index) => {
            return {
                name: `سيرفر ${index + 1}`,
                quality: srv.quality,
                iframe_url: srv.iframe_url
            };
        });

        movie.servers = finalSortedServers;

        console.log(`\n🎉 انتصار كامل في بيئة التجميع! إجمالي السيرفرات المستخرجة: ${finalSortedServers.length}`);
        console.log(JSON.stringify(finalSortedServers, null, 2));

        fs.writeFileSync(path.join(process.cwd(), 'single_movie_result.json'), JSON.stringify(movie, null, 2), 'utf-8');

    } catch (error) {
        console.error('❌ حدث خطأ في الـ Workflow:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
