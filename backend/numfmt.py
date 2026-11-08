import omml as M


def fmt(value, sig=4):
    if value == 0:
        return "0"
    mag = abs(value)
    if mag < 1e-3 or mag >= 1e5:
        mantissa, exp = _sci_parts(value, sig)
        return f"{mantissa} x 10^{exp}"
    decimals = max(0, sig - 1 - _order_of_magnitude(value))
    return f"{value:.{min(decimals, 6)}f}"


def _order_of_magnitude(value):
    import math

    return int(math.floor(math.log10(abs(value))))


def _sci_parts(value, sig=4):
    exp = _order_of_magnitude(value)
    mantissa = value / (10 ** exp)
    return f"{mantissa:.{sig - 1}f}", str(exp)


def eq_number(value, sig=4):
    if value == 0:
        return [M.run("0")]
    mag = abs(value)
    if mag < 1e-3 or mag >= 1e5:
        mantissa, exp = _sci_parts(value, sig)
        return [M.run(f"{mantissa} x "), M.sup(["10"], [exp])]
    return [M.run(fmt(value, sig))]
