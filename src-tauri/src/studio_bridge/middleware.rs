use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware::Next,
    response::Response,
};

pub async fn require_json_for_post(req: Request, next: Next) -> Result<Response, StatusCode> {
    if req.method() == Method::POST {
        let has_body = req
            .headers()
            .get(axum::http::header::CONTENT_LENGTH)
            .and_then(|val| val.to_str().ok())
            .and_then(|val| val.parse::<u64>().ok())
            .is_some_and(|len| len > 0)
            || req.headers().contains_key(axum::http::header::TRANSFER_ENCODING);
        let is_json = req
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|val| val.to_str().ok())
            .is_some_and(|val| val.starts_with("application/json"));
        if has_body && !is_json {
            return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
    }
    Ok(next.run(req).await)
}
