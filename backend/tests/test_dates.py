import pytest

from app.dates import parse_date, provably_before, sort_key


def test_year_only():
    d = parse_date("1950")
    assert d.year == 1950
    assert d.month is None
    assert d.day is None


def test_year_month():
    d = parse_date("1950-03")
    assert (d.year, d.month, d.day) == (1950, 3, None)


def test_full_date():
    d = parse_date("1950-03-07")
    assert (d.year, d.month, d.day) == (1950, 3, 7)


@pytest.mark.parametrize("bad", ["1950-13", "19", "1950-02-30", "", "abc", "1950-3-7", "1950-00"])
def test_invalid_dates(bad):
    with pytest.raises(ValueError):
        parse_date(bad)


def test_leap_day():
    assert parse_date("2000-02-29").day == 29
    with pytest.raises(ValueError):
        parse_date("1900-02-29")


def test_sort_order():
    assert sort_key("1950") < sort_key("1950-06") < sort_key("1951")
    assert sort_key("1950-06") < sort_key("1950-06-02")


def test_none_sorts_last():
    assert sort_key(None) > sort_key("9999-12-31")
    assert sorted([None, "1951", "1950"], key=sort_key) == ["1950", "1951", None]


@pytest.mark.parametrize(
    "a, b, expected",
    [
        ("1949", "1950-06", True),
        ("1950", "1950-06", False),
        ("1950-05", "1950-06-10", True),
        ("1950-06", "1950-06-10", False),
        ("1950-06-10", "1950-06-10", False),
        ("1950", "1950", False),
        ("1950-06-09", "1950-06-10", True),
        ("1950-06-10", "1950-06-09", False),
    ],
)
def test_provably_before(a, b, expected):
    assert provably_before(a, b) is expected
