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
        // 1. 네이버 블로그 비공개 API 호출 (글 번호, 제목 가져오기)
        const listUrl = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=1&categoryNo=${categoryNo}&parentCategoryNo=&countPerPage=5`;
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
        
        // 💡 JSON 문법 검사를 무시하고 정규식으로 안전하게 추출
        const logNos = [...rawText.matchAll(/"logNo":"(\d+)"/g)].map(m => m[1]);
        const titles = [...rawText.matchAll(/"title":"((?:\\"|[^"])*)"/g)].map(m => m[1]);
        const addDates = [...rawText.matchAll(/"addDate":"(.*?)"/g)].map(m => m[1]);

        const listData = { postList: [] };
        const count = Math.min(logNos.length, titles.length, addDates.length);
        
        for (let i = 0; i < count; i++) {
            listData.postList.push({
                logNo: logNos[i],
                title: titles[i].replace(/\\"/g, '"').replace(/\\\\/g, '\\'), 
                addDate: addDates[i]
            });
        }

        if (listData.postList.length === 0) {
            return res.status(200).json({ items: [] });
        }

        // 2. 💡 [핵심 진화] 각 블로그 글의 실제 웹페이지에 접속하여 본문 내용 긁어오기!
        const fetchSummary = async (logNo) => {
            try {
                const postUrl = `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`;
                const postRes = await fetch(postUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                const html = await postRes.text();

                // 네이버 블로그 본문 컨테이너(se-main-container) 안의 텍스트만 추출
                const containerMatch = html.match(/class="se-main-container"[^>]*>([\s\S]*?)<\/div>\s*<!-- \/\/본문 내용 -->/);
                let content = "";
                
                if (containerMatch) {
                    content = containerMatch[1];
                } else {
                    const fallbackMatch = html.match(/id="postViewArea"[^>]*>([\s\S]*?)<\/div>/);
                    if (fallbackMatch) content = fallbackMatch[1];
                }

                if (content) {
                    // HTML 태그 제거 및 띄어쓰기 정리
                    let text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    // 너무 길면 200자로 자르기
                    if (text.length > 200) text = text.substring(0, 200) + '...';
                    
                    // 만약 본문을 찾았지만 너무 짧다면 기본 멘트 사용
                    if (text.length > 20) return text;
                }
            } catch(e) {
                console.error(`본문 추출 실패 (${logNo}):`, e);
            }
            return "해당 수임 사례의 전체 진행 과정 및 상세 검토 사항은 온:ON 공식 블로그 원문에서 확인하실 수 있습니다.";
        };

        // 3. 추출한 글 번호(logNo)들을 바탕으로 본문 요약문을 동시 다발적으로 긁어오기
        const itemsWithSummaries = await Promise.all(
            listData.postList.map(async (post) => {
                let decodedTitle = post.title || '';
                try {
                    decodedTitle = decodeURIComponent(post.title.replace(/\+/g, ' '));
                } catch (e) { }

                // 본문 긁어오기 함수 실행
                const summary = await fetchSummary(post.logNo);

                return {
                    title: decodedTitle,
                    link: `https://blog.naver.com/${blogId}/${post.logNo}`,
                    pubDate: post.addDate || '',
                    description: summary
                };
            })
        );

        return res.status(200).json({ items: itemsWithSummaries });

    } catch (error) {
        console.error('Vercel Serverless Function Error:', error);
        return res.status(200).json({ items: [] });
    }
}
