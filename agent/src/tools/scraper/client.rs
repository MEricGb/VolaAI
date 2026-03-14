//! gRPC client wrapping the Python scraper service.
//!
//! [`ScraperClient`] is constructed once at startup and shared via `Arc`.
//! It holds a single tonic channel to the scraper gRPC endpoint.

use tonic::transport::Channel;

use crate::error::AppError;

pub mod scraping_proto {
    tonic::include_proto!("scraping");
}

use scraping_proto::{
    scraping_service_client::ScrapingServiceClient, SearchRequest, SearchResponse,
};

/// Shared gRPC client for the Python scraper service.
pub struct ScraperClient {
    inner: ScrapingServiceClient<Channel>,
}

impl ScraperClient {
    /// Connect to the scraper service at the given URL.
    ///
    /// Call once at startup and wrap in `Arc`.
    pub fn connect(url: String) -> Result<Self, AppError> {
        let channel = Channel::from_shared(url)
            .map_err(|e| AppError::Config(anyhow::anyhow!("Invalid scraper URL: {e}")))?
            .connect_lazy();
        Ok(Self {
            inner: ScrapingServiceClient::new(channel),
        })
    }

    /// Send a search request to the scraper and return the raw response.
    pub async fn search(
        &self,
        session_id: String,
        user_message: String,
    ) -> Result<SearchResponse, AppError> {
        let mut client = self.inner.clone();
        let response = client
            .search_flights(SearchRequest {
                session_id,
                user_message,
            })
            .await?;
        Ok(response.into_inner())
    }
}
