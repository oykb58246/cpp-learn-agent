#include <iostream>

int main() {
    int value = 0;
    std::cin >> value;
    std::cout << (value % 2 == 0 ? "odd" : "even");
    return 0;
}
