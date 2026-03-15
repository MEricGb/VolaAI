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
        tracing::info!(scraper_url = %url, "Connecting to scraper gRPC service");
        let channel = Channel::from_shared(url)
            .map_err(|e| AppError::Config(anyhow::anyhow!("Invalid scraper URL: {e}")))?
            .connect_lazy();
        Ok(Self {
            inner: ScrapingServiceClient::new(channel),
        })
    }

    /// Send a structured search request to the scraper and return the response.
    #[allow(clippy::too_many_arguments)]
    pub async fn search(
        &self,
        origin: String,
        destination: String,
        depart_date: String,
        return_date: String,
        adults: u32,
        children: u32,
        is_one_way: bool,
    ) -> Result<SearchResponse, AppError> {
        tracing::info!(%origin, %destination, %depart_date, "ScraperClient: sending gRPC request");
        let mut client = self.inner.clone();
        let response = client
            .search_flights(SearchRequest {
                origin,
                destination,
                depart_date,
                return_date,
                adults: adults as i32,   // safe: passenger counts never exceed i32::MAX
                children: children as i32, // safe: passenger counts never exceed i32::MAX
                is_one_way,
            })
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "ScraperClient: gRPC call failed");
                AppError::from(e)
            })?;
        tracing::info!(offers = response.get_ref().offers.len(), "ScraperClient: gRPC response received");
        Ok(response.into_inner())
    }
}
