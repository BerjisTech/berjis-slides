const w = typeof window !== 'undefined' ? (window as any) : {};

export const environment = {
  production: true,
  apiBase: w && typeof w.__BERJIS_API__ === 'string' && w.__BERJIS_API__.trim().length
    ? w.__BERJIS_API__.trim()
    : 'https://api.berjis.tech',
  slidesApiBase: w && typeof w.__SLIDES_API__ === 'string' && w.__SLIDES_API__.trim().length
    ? w.__SLIDES_API__.trim()
    : 'https://slides-api.berjis.tech'
};
