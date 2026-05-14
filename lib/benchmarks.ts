
export async function fetchSessionCookie(): Promise<string> {
  const response = await fetch('https://niftyindices.com/reports/historical-data', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });

  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Failed to fetch session cookie from NiftyIndices');
  }
  return setCookie;
}

export async function fetchFullNiftyTRIHistory(indexName: string): Promise<Array<{date: string, value: number}>> {
  const cookie = await fetchSessionCookie();
  const today = new Date();
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const todayAsDDMonYYYY = `${today.getDate().toString().padStart(2, '0')}-${months[today.getMonth()]}-${today.getFullYear()}`;

  const cinfo = `{'name':'${indexName}','startDate':'01-Jan-2000','endDate':'${todayAsDDMonYYYY}','indexName':'${indexName}'}`;

  const response = await fetch('https://niftyindices.com/Backpage.aspx/getTotalReturnIndexString', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': 'https://niftyindices.com',
      'Referer': 'https://niftyindices.com/reports/historical-data',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Cookie': cookie
    },
    body: JSON.stringify({ cinfo })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch TRI data: ${response.statusText}`);
  }

  const json = await response.json() as { d: string };
  const rawData = JSON.parse(json.d) as Array<{ "Index Name": string, Date: string, TotalReturnsIndex: string }>;

  const data = rawData.map(row => {
    try {
      const dateObj = new Date(row.Date);
      if (isNaN(dateObj.getTime())) return null;
      const value = parseFloat(row.TotalReturnsIndex.replace(/,/g, ''));
      if (isNaN(value)) return null;

      return {
        date: dateObj.toISOString().split('T')[0],
        value
      };
    } catch {
      return null;
    }
  }).filter((item): item is { date: string, value: number } => item !== null);

  return data.sort((a, b) => a.date.localeCompare(b.date));
}
