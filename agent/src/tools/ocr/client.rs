//! gRPC client wrapping the Python OCR service.
//!
//! [`OcrClient`] is constructed once at startup and shared via `Arc`.
//! It holds a single tonic channel to the OCR gRPC endpoint.

use tonic::transport::Channel;

use crate::error::AppError;

pub mod ocr_proto {
    tonic::include_proto!("ocr");
}

use ocr_proto::{ocr_service_client::OcrServiceClient, ExtractBookingRequest, ExtractBookingResponse};

/// Shared gRPC client for the Python OCR service.
pub struct OcrClient {
    inner: OcrServiceClient<Channel>,
}

impl OcrClient {
    /// Connect to the OCR service at the given URL.
    pub fn connect(url: String) -> Result<Self, AppError> {
        tracing::info!(ocr_url = %url, "Connecting to OCR gRPC service");
        let channel = Channel::from_shared(url)
            .map_err(|e| AppError::Config(anyhow::anyhow!("Invalid OCR URL: {e}")))?
            .connect_lazy();
        Ok(Self {
            inner: OcrServiceClient::new(channel),
        })
    }

    /// Extract structured booking information from an image.
    pub async fn extract_booking_info(
        &self,
        session_id: String,
        image_url: String,
        ocr_backend: String,
    ) -> Result<ExtractBookingResponse, AppError> {
        let mut client = self.inner.clone();
        let response = client
            .extract_booking_info(ExtractBookingRequest {
                session_id,
                image_url,
                ocr_backend,
            })
            .await?;
        Ok(response.into_inner())
    }
}
