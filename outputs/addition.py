def add(a, b):
    return a + b

if __name__ == "__main__":
    x = float(input("Enter first number: "))
    y = float(input("Enter second number: "))
    result = add(x, y)
    print(f"Result: {x} + {y} = {result}")
