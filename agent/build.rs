fn main() -> Result<(), Box<dyn std::error::Error>> {
    tonic_build::compile_protos("proto/agent.proto")?;
    tonic_build::compile_protos("proto/scraping.proto")?;
    tonic_build::compile_protos("proto/ocr.proto")?;
    Ok(())
}
