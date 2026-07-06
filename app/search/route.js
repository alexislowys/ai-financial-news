// app/search/route.js
// The search box submits here (?q=aapl); we clean the input and redirect to
// the stock page. Invalid input goes home. Plain HTML form, no client JS.

import { redirect } from "next/navigation";
import { normalizeTicker } from "../../lib/db";

export async function GET(request) {
  const q = new URL(request.url).searchParams.get("q");
  const ticker = normalizeTicker(q ?? "");
  redirect(ticker ? `/stock/${ticker}` : "/");
}
