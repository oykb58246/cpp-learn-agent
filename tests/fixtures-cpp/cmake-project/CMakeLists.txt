cmake_minimum_required(VERSION 3.20)
project(CppPetCmakeFixture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(cpppet_sum src/sum.cpp)
target_include_directories(cpppet_sum PUBLIC include)

add_executable(cpppet_fixture src/main.cpp)
target_link_libraries(cpppet_fixture PRIVATE cpppet_sum)

enable_testing()
add_executable(cpppet_sum_test tests/sum_test.cpp)
target_link_libraries(cpppet_sum_test PRIVATE cpppet_sum)
add_test(NAME sum_basic COMMAND cpppet_sum_test)
