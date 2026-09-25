// Native C++ tests of the exact loader helper; no model or fake recognition.
#include "manabi_model_reader.hpp"
#include <cerrno>
#include <fcntl.h>
#include <functional>
#include <iostream>
#include <limits>
#include <string>
#include <unistd.h>
using namespace manabi_web;
static void require(bool ok) { if (!ok) throw std::runtime_error("assertion failed"); }
static void throws(const std::function<void()>& fn) {
    try { fn(); } catch (const std::runtime_error&) { return; }
    throw std::runtime_error("expected exception");
}
static ModelFile fixture(std::size_t size) {
    ModelFile file(std::tmpfile(), &std::fclose); require(bool(file));
    std::vector<uint8_t> block(65536);
    for (std::size_t off = 0; off < size;) {
        auto n = std::min(block.size(), size-off);
        for (std::size_t i=0; i<n; ++i) block[i] = uint8_t((off+i)*31u+7u);
        require(std::fwrite(block.data(), 1, n, file.get()) == n); off += n;
    }
    require(std::fflush(file.get()) == 0); return file;
}
int main(int argc, char** argv) {
    try {
        require(argc == 2); const std::string test = argv[1];
        std::vector<uint8_t> staging;
        const auto span = model_staging_limit*3+17;
        auto file = fixture(span+137);
        std::size_t copied=0, calls=0;
        auto check=[] {};
        auto verify=[&](const uint8_t* bytes, std::size_t offset, std::size_t count) {
            require(offset==copied && count <= model_staging_limit);
            for (std::size_t i=0;i<count;++i) require(bytes[i] == uint8_t((offset+i+137)*31u+7u));
            copied+=count; ++calls;
        };
        if (test=="bounded-copy") {
            transfer_tensor(file.get(),137,span,staging,verify,check);
            require(copied==span && calls==4 && staging.size()==model_staging_limit);
            auto address=staging.data();
            for (std::size_t n : {1u,17u,97u,4099u}) {
                copied=0; transfer_tensor(file.get(),137,n,staging,verify,check);
                require(copied==n && staging.data()==address);
            }
        } else if (test=="growing-tensor-sizes") {
            // A vector that grows from 3 MiB to 4 MiB can reserve 6 MiB. Test
            // allocated capacity as well as logical size across increasing tensors.
            for (std::size_t n : {model_staging_limit*3/4,model_staging_limit}) {
                copied=0; transfer_tensor(file.get(),137,n,staging,verify,check);
                require(copied==n && staging.size()<=model_staging_limit && staging.capacity()<=model_staging_limit);
            }
        } else if (test=="short-read") {
            throws([&] { transfer_tensor(file.get(),137,span+1,staging,verify,check); });
            require(copied==3*model_staging_limit && calls==3);
        } else if (test=="cancel-before-read") {
            throws([&] { transfer_tensor(file.get(),137,span,staging,verify,[]{throw std::runtime_error("cancel");}); });
            require(staging.empty() && calls==0);
        } else if (test=="cancel-before-upload") {
            unsigned checks=0;
            throws([&] { transfer_tensor(file.get(),137,span,staging,verify,[&]{if(++checks==3) throw std::runtime_error("cancel");}); });
            require(calls==0);
        } else if (test=="cancel-between-chunks") {
            throws([&] { transfer_tensor(file.get(),137,span,staging,verify,[&]{if(calls==1) throw std::runtime_error("cancel");}); });
            require(calls==1 && copied==model_staging_limit);
        } else if (test=="exception-closes-file") {
            auto fd=::fileno(file.get());
            throws([&] {
                auto owned=std::move(file);
                transfer_tensor(owned.get(),0,1,staging,[](const uint8_t*,std::size_t,std::size_t){throw std::runtime_error("upload");},check);
            });
            errno=0;require(::fcntl(fd,F_GETFD)==-1 && errno==EBADF);
        } else if (test=="offset-overflow") {
            require(model_offset(17,29)==46);
            throws([&]{model_offset(std::size_t(LONG_MAX),1);});
            throws([&]{model_offset(0,std::numeric_limits<std::size_t>::max());});
            throws([&]{transfer_tensor(file.get(),std::size_t(LONG_MAX),1,staging,verify,check);});
            throws([&]{transfer_tensor(nullptr,0,1,staging,verify,check);});
            require(calls==0 && staging.empty());
        } else if (test=="zero-tensor") {
            transfer_tensor(file.get(),0,0,staging,verify,check);require(calls==0 && staging.empty());
        } else throw std::runtime_error("unknown test");
        std::cout << "PASS " << test << '\n';
    } catch(const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
