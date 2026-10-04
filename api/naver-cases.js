// api/naver-cases.js
export default async function handler(req, res) {
    // 💡 CORS 보안 에러 완벽 차단
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const blogId = 'juuudy_';
    const categoryNo = req.query.categoryNo || '67'; 
    
    try {
        // 1. 네이버 블로그 비공개 API 호출
        const listUrl = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=1&categoryNo=${categoryNo}&parentCategoryNo=&countPerPage=3`;
        const listResponse = await fetch(listUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': `https://blog.naver.com/${blogId}`
            }
        });
        
        if (!listResponse.ok) {
            throw new Error(`Naver API responded with status: ${listResponse.status}`);
        }

        const rawText = await listResponse.text();
        
        // 💡 [무적의 해결책] JSON 파싱(문법 검사)을 아예 포기하고, 정규식으로 필요 데이터만 강제 추출!
        const logNos = [...rawText.matchAll(/"logNo":"(\d+)"/g)].map(m => m[1]);
        const titles = [...rawText.matchAll(/"title":"((?:\\"|[^"])*)"/g)].map(m => m[1]);
        const addDates = [...rawText.matchAll(/"addDate":"(.*?)"/g)].map(m => m[1]);

        const listData = { postList: [] };
        const count = Math.min(logNos.length, titles.length, addDates.length);
        
        for (let i = 0; i < count; i++) {
            listData.postList.push({
                logNo: logNos[i],
                title: titles[i].replace(/\\"/g, '"').replace(/\\\\/g, '\\'), // 이스케이프 문자 복구
                addDate: addDates[i]
            });
        }

        if (listData.postList.length === 0) {
            return res.status(200).json({ items: [] });
        }

        // 2. 최신 전체 글의 요약문(description)을 가져오기 위해 RSS 동시 호출
        let rssItems = [];
        try {
            const rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;
            const rssResponse = await fetch(rssUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            const rssXml = await rssResponse.text();

            const itemRegex = /<item>([\s\S]*?)<\/item>/g;
            let match;
            while ((match = itemRegex.exec(rssXml)) !== null) {
                const itemHtml = match[1];
                const linkMatch = itemHtml.match(/<link>(.*?)<\/link>/);
                const link = linkMatch ? linkMatch[1] : '';
                const logNoMatch = link.match(/\/(\d+)$/);
                const logNo = logNoMatch ? logNoMatch[1] : null;

                let description = '';
                const descMatch = itemHtml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
                if (descMatch) {
                    description = descMatch[1].replace(/<[^>]*>?/gm, '').trim(); 
                } else {
                    const altDescMatch = itemHtml.match(/<description>([\s\S]*?)<\/description>/);
                    if (altDescMatch) {
                        description = altDescMatch[1].replace(/<[^>]*>?/gm, '').trim();
                    }
                }

                if (logNo) {
                    rssItems.push({ logNo, description });
                }
            }
        } catch (e) {
            console.error('RSS Fetch Error:', e);
        }

        // 3. [카테고리 글 목록] + [RSS 요약문] 결합
        const items = listData.postList.map(post => {
            let decodedTitle = post.title || '';
            try {
                // URI 인코딩된 문자가 있을 경우 디코딩
                decodedTitle = decodeURIComponent(post.title.replace(/\+/g, ' '));
            } catch (e) { }

            const matchedRss = rssItems.find(r => r.logNo === post.logNo);
            
            return {
                title: decodedTitle,
                link: `https://blog.naver.com/${blogId}/${post.logNo}`,
                pubDate: post.addDate || '',
                description: matchedRss ? matchedRss.description : "해당 수임 사례의 전체 진행 과정 및 상세 검토 사항은 온:ON 공식 블로그 원문에서 직접 확인하실 수 있습니다."
            };
        });

        // 최종 성공 데이터 반환!
        return res.status(200).json({ items });

    } catch (error) {
        console.error('Vercel Serverless Function Error:', error);
        return res.status(200).json({ items: [] });
    }
}
