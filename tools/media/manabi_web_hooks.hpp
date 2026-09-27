#pragma once
bool manabi_web_cancel_requested();
void manabi_web_check_cancel();
// Called by the owning inference Worker, never the ggml compute pthreads.
extern "C" void manabi_web_output(const char* data, int length);
