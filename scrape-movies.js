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
    // إضافة خصائص تمنع كشف Playwright
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ar-SA', 'ar', 'en-US', 'en'],
        });
        window.chrome = {
            runtime: {},
        };
    });

    // محاكاة أبعاد شاشة حقيقية
    await page.setViewportSize({
        width: 1920 + Math.floor(Math.random() * 100),
        height: 1080 + Math.floor(Math.random() * 100)
    });

    // إضافة User-Agent حقيقي
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    
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
        console.log('🔄 جاري تحميل الصفحة...');
        
        // محاكاة سلوك بشري
        await simulateHumanBehavior(page);
        
        // تعطيل تحميل الصور والخطوط لتسريع العملية (اختياري)
        await page.route('**/*', (route) => {
            const request = route.request();
            if (request.resourceType() === 'image' || request.resourceType() === 'font') {
                route.abort();
            } else {
                route.continue();
            }
        });

        // تحميل الصفحة مع مهلة كافية
        await page.goto('https://m.asd.ink/category/arabic-movies-14/', {
            waitUntil: 'networkidle',
            timeout: 30000,
        });

        // انتظار للتأكد من تجاوز Cloudflare
        console.log('⏳ في انتظار تجاوز حماية Cloudflare...');
        await page.waitForTimeout(5000);

        // محاولة تحريك الماوس بشكل عشوائي لمحاكاة سلوك بشري
        await page.mouse.move(
            Math.random() * 500,
            Math.random() * 500
        );
        await page.waitForTimeout(2000);

        // التمرير التدريجي
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= document.body.scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 1000);
            });
        });

        await page.waitForTimeout(2000);

        // التحقق من وجود المحتوى
        const contentExists = await page.$('.movie__block');
        if (!contentExists) {
            console.log('⚠️ لم يتم العثور على محتوى، قد تكون هناك حماية إضافية');
            // حفظ لقطة شاشة للتشخيص
            await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
        }

        // استخراج بيانات الأفلام
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
                        const movie = {
                            title: titleElement.textContent.trim(),
                            url: linkElement.href,
                            image: imgElement ? imgElement.src : null,
                            image_alt: imgElement ? imgElement.alt : null,
                            category: categoryElement ? categoryElement.textContent.trim() : null,
                            genre: genreElement ? genreElement.textContent.trim() : null,
                            quality: qualityElement ? qualityElement.textContent.trim() : null,
                            description: descriptionElement ? descriptionElement.textContent.trim() : null,
                            scraped_at: new Date().toISOString(),
                        };
                        moviesData.push(movie);
                    }
                } catch (error) {
                    console.error('خطأ في استخراج بيانات فيلم:', error);
                }
            });

            return moviesData;
        });

        // إعداد ملف JSON مع معلومات إضافية
        const outputData = {
            metadata: {
                source: 'https://m.asd.ink/category/arabic-movies-14/',
                scraped_at: new Date().toISOString(),
                total_movies: movies.length,
                status: 'success',
            },
            movies: movies,
        };

        // حفظ البيانات
        const outputPath = path.join(process.cwd(), 'movies.json');
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

        console.log(`✅ تم استخراج ${movies.length} فيلم بنجاح!`);
        console.log(`📁 تم حفظ البيانات في: ${outputPath}`);

        // طباعة عناوين الأفلام
        if (movies.length > 0) {
            console.log('\n📋 قائمة الأفلام المستخرجة:');
            movies.forEach((movie, index) => {
                console.log(`${index + 1}. ${movie.title}`);
                if (movie.genre) console.log(`   النوع: ${movie.genre}`);
                if (movie.quality) console.log(`   الجودة: ${movie.quality}`);
            });
        }

    } catch (error) {
        console.error('❌ حدث خطأ أثناء الاستخراج:', error);
        
        // حفظ لقطة شاشة للتشخيص
        try {
            await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
            console.log('📸 تم حفظ لقطة شاشة للتشخيص');
        } catch (screenshotError) {
            console.error('لم نتمكن من حفظ لقطة الشاشة:', screenshotError);
        }
        
        // إنشاء ملف بيانات فارغ في حالة الخطأ
        const errorOutput = {
            metadata: {
                source: 'https://m.asd.ink/category/arabic-movies-14/',
                scraped_at: new Date().toISOString(),
                total_movies: 0,
                status: 'error',
                error_message: error.message,
            },
            movies: [],
        };
        
        fs.writeFileSync(
            path.join(process.cwd(), 'movies.json'),
            JSON.stringify(errorOutput, null, 2),
            'utf-8'
        );
        
        process.exit(1);
        
    } finally {
        await browser.close();
    }
}

// تشغيل السكريبت
scrapeMovies().catch(console.error);
