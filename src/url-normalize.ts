// 計測のためだけに付く、ページの中身に関係しないクエリパラメータ
const trackingParams = new Set([
	"fbclid",
	"gclid",
	"yclid",
	"mc_cid",
	"mc_eid",
	"igshid",
]);

const isTrackingParam = (key: string): boolean => {
	const lower = key.toLowerCase();
	return lower.startsWith("utm_") || trackingParams.has(lower);
};

// 同じページを指すURLを同じ文字列に揃える(重複判定用)。
// 計測用クエリ・フラグメント・末尾スラッシュを除き、クエリの並び順を揃える。
// ホスト名の小文字化は new URL() が行う。
// 上記以外のクエリは記事の識別そのものの場合があるため残す。
// URLとして解釈できない文字列は、元のまま返す。
export const normalizeUrl = (link: string): string => {
	let url: URL;
	try {
		url = new URL(link.trim());
	} catch {
		return link;
	}

	url.hash = "";
	for (const key of [...url.searchParams.keys()]) {
		if (isTrackingParam(key)) {
			url.searchParams.delete(key);
		}
	}
	url.searchParams.sort();
	if (url.pathname.length > 1) {
		url.pathname = url.pathname.replace(/\/+$/, "") || "/";
	}

	return url.toString();
};
