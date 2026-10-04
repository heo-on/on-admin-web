// api/naver-cases.js
export default async function handler(req, res) {
    // 💡 브라우저 CORS 보안 에러 완벽 차단 (Vercel 내부 통과 설정)
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
    // 프론트엔드에서 카테고리 번호를 넘겨주면 받음 (기본값: 67번)
    const categoryNo = req.query.categoryNo || '67'; 
    
    try {
        // 1. 네이버 블로그 비공개 API 호출 (지정된 카테고리의 글 3개만 정확히 타겟팅)
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
        // 네이버가 내려주는 JSON 찌꺼기 텍스트 안전하게 제거 후 파싱
        const listData = JSON.parse(rawText.replace(/^[^{]*/, '')); 

        if (!listData.postList || listData.postList.length === 0) {
            return res.status(200).json({ items: [] });
        }

        // 2. 최신 전체 글의 요약문(description)을 가져오기 위해 RSS 동시 호출
        const rssUrl = `https://rss.blog.naver.com/${blogId}.xml`;
        const rssResponse = await fetch(rssUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const rssXml = await rssResponse.text();

        // 3. 정규식으로 RSS 구역 파싱하여 요약문 확보 (무거운 외부 패키지 없이 가볍게 100% 동작)
        const rssItems = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(rssXml)) !== null) {
            const itemHtml = match[1];
            
            // 글 고유 번호(logNo) 추출
            const linkMatch = itemHtml.match(/<link>(.*?)<\/link>/);
            const link = linkMatch ? linkMatch[1] : '';
            const logNoMatch = link.match(/\/(\d+)$/);
            const logNo = logNoMatch ? logNoMatch[1] : null;

            // 요약문 내용 및 HTML 태그 찌꺼기 제거
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

        // 4. [카테고리 글 목록] + [RSS 요약문] 완벽 결합
        const items = listData.postList.map(post => {
            // 네이버가 제목을 인코딩해서 줄 경우를 대비한 안전한 디코딩
            let decodedTitle = post.title;
            try {
                decodedTitle = decodeURIComponent(post.title.replace(/\+/g, ' '));
            } catch (e) { }

            // RSS에서 해당 글 번호와 일치하는 요약문 찾기
            const matchedRss = rssItems.find(r => r.logNo === post.logNo);
            
            return {
                title: decodedTitle,
                link: `https://blog.naver.com/${blogId}/${post.logNo}`,
                pubDate: post.addDate, // "2026. 9. 28." 포맷 유지
                
                // 💡 글이 너무 오래되어 RSS(최신50개)에서 요약문이 지워졌더라도, 이 문구로 자연스럽게 대처합니다!
                description: matchedRss ? matchedRss.description : "해당 수임 사례의 전체 진행 과정 및 상세 검토 사항은 온:ON 공식 블로그 원문에서 직접 확인하실 수 있습니다."
            };
        });

        // 5. 프론트엔드로 깔끔하게 완성된 3개 데이터 전송
        return res.status(200).json({ items });

    } catch (error) {
        console.error('Vercel Serverless Function Error:', error);
        return res.status(500).json({ error: error.message, items: [] });
    }
}
