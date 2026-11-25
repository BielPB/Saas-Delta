/**
 * The product calls client_services "Subdivisões". A few strings still come
 * from SQL (e.g. "Sem serviço"); translate them at display time.
 */
export function subdivisionText(s: string) {
  return s
    .replace(/Sem serviço/g, "Sem subdivisão")
    .replace(/mesmo serviço da pasta/g, "mesma subdivisão da pasta")
    .replace(/clientes e serviços/g, "clientes e subdivisões");
}
