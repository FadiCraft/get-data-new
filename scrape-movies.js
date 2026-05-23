const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// تكوين المتصفح لتجاوز Cloudflare
const browserConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
    ]
};

// محاكاة سلوك بشري لتجنب كشف البوت
async function simulateHumanBehavior(page) {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
        window.chrome = { runtime: {} };
    });

    await page.setViewportSize({
        width: 1920 + Math.floor(Math.random() * 100),
        height: 1080 + Math.floor(Math.random() * 100)
    });

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    });
}

async function scrapeMovies() {
    const browser = await chromium.launch(browserConfig);
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'ar-SA',
        timezoneId: 'Asia/Riyadh',
        geolocation: { longitude: 46.6753, latitude: 24.7136 },
        permissions: ['geolocation'],
    });

    const page = await context.newPage();
    
    try {
        console.log('🔄 جاري تحميل الصفحة الرئيسية للأفلام...');
        await simulateHumanBehavior(page);
        
        // تعطيل تحميل الصور لتسريع العملية
        await page.route('**/*', (route) => {
            const request = route.request();
            if (request.resourceType() === 'image' || request.resourceType() === 'font') {
                route.abort();
            } else {
                route.continue();
            }
        });

        // تحميل الصفحة الرئيسية
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'networkidle',
            timeout: 60000,
        });

        console.log('⏳ في انتظار تجاوز حماية Cloudflare والتمرير...');
        await page.waitForTimeout(5000);

        // التمرير التدريجي لجلب الأفلام
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 400;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight || totalHeight > 3000) { // حددنا الارتفاع منعاً للتكرار اللانهائي
                        clearInterval(timer);
                        resolve();
                    }
                }, 500);
            });
        });

        // استخراج بيانات الأفلام الأساسية
        const movies = await page.evaluate(() => {
            const movieElements = document.querySelectorAll('li .item__contents');
            const moviesData = [];

            movieElements.forEach((element) => {
                try {
                    const linkElement = element.querySelector('a.movie__block');
                    const imgElement = element.querySelector('img');
                    const titleElement = element.querySelector('h3');
                    const categoryElement = element.querySelector('.post__category');
                    const genreElement = element.querySelector('.__genre');
                    const qualityElement = element.querySelector('.__quality');
                    const descriptionElement = element.querySelector('.post__info p');

                    if (linkElement && titleElement) {
                        // تحويل رابط الفيلم العادي إلى رابط صفحة المشاهدة
                        // مثال: من https://m.asd.ink/movie/abc إلى https://m.asd.ink/watch/abc
                        let watchUrl = linkElement.href;
                        if (watchUrl.includes('/movie/')) {
                            watchUrl = watchUrl.replace('/movie/', '/watch/');
                        } else {
                            // إذا لم يكن يحتوي على /movie/، نقوم بصياغته أو تركه كما هو حسب النظام لديك
                            // تحسباً، إذا كان الرابط ينتهي باسم الفيلم مباشرة يمكنك تعديله هنا
                        }

                        moviesData.push({
                            title: titleElement.textContent.trim(),
                            movie_url: linkElement.href,
                            watch_url: watchUrl, // الرابط الجديد المجهز للمشاهدة
                            image: imgElement ? imgElement.src : null,
                            category: categoryElement ? categoryElement.textContent.trim() : null,
                            genre: genreElement ? genreElement.textContent.trim() : null,
                            quality: qualityElement ? qualityElement.textContent.trim() : null,
                            description: descriptionElement ? descriptionElement.textContent.trim() : null,
                            servers: [] // مصفوفة فارغة سنملأها لاحقاً
                        });
                    }
                } catch (e) {
                    console.error(e);
                }
            });
            return moviesData;
        });

        console.log(`🎬 تم العثور على ${movies.length} فيلم. جاري استخراج السيرفرات لكل فيلم...`);

        // الآن ندخل إلى صفحة مشاهدة كل فيلم لاستخراج السيرفرات
        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            console.log(`🔗 [${i + 1}/${movies.length}] جاري فتح صفحة المشاهدة لـ: ${movie.title}`);
            
            try {
                // الانتقال لصفحة المشاهدة
                await page.goto(movie.watch_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // انتظار بسيط لضمان تحميل عناصر السيرفرات
                await page.waitForTimeout(2000); 

                // استخراج السيرفرات من بنية الـ HTML الخاصة بالصفحة
                const servers = await page.evaluate(() => {
                    const serverItems = document.querySelectorAll('.servers__list ul li');
                    const extractedServers = [];

                    serverItems.forEach((li) => {
                        const nameElement = li.querySelector('span');
                        const link = li.getAttribute('data-link');
                        const quality = li.getAttribute('data-qu');
                        
                        if (link) {
                            extractedServers.push({
                                name: nameElement ? nameElement.textContent.trim() : 'سيرفر غير معروف',
                                link: link,
                                quality: quality || 'unknown'
                            });
                        }
                    });
                    return extractedServers;
                });

                movie.servers = servers;
                console.log(`✅ تم استخراج ${servers.length} سيرفر لهذا الفيلم.`);

            } catch (movieError) {
                console.error(`❌ فشل استخراج سيرفرات الفيلم ${movie.title}:`, movieError.message);
            }
            
            // انتظار عشوائي بسيط بين الفيلم والآخر لتجنب الحظر
            await page.waitForTimeout(1000 + Math.random() * 1000);
        }

        // حفظ البيانات النهائية في ملف JSON
        const outputData = {
            metadata: {
                source: 'https://m.asd.ink/category/arabic-movies-14/',
                scraped_at: new Date().toISOString(),
                total_movies: movies.length,
                status: 'success',
            },
            movies: movies,
        };

        const outputPath = path.join(process.cwd(), 'movies_with_servers.json');
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

        console.log(`\n🚀 اكتملت العملية بنجاح! تم حفظ ملف الأفلام والسيرفرات في: ${outputPath}`);

    } catch (error) {
        console.error('❌ حدث خطأ عام:', error);
    } finally {
        await browser.close();
    }
}

scrapeMovies().catch(console.error);
