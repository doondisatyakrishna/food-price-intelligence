import os
from sqlalchemy import (
    Column,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()


class Market(Base):
  __tablename__ = "markets"
  __table_args__ = (
      UniqueConstraint(
          "name", "district", "state", name="uq_market_name_district_state"
      ),
  )

  id = Column(Integer, primary_key=True, autoincrement=True)
  name = Column(String(100), nullable=False)
  district = Column(String(100), nullable=False)
  state = Column(String(50), nullable=False)


class Commodity(Base):
  __tablename__ = "commodities"

  id = Column(Integer, primary_key=True, autoincrement=True)
  name = Column(String(100), nullable=False, unique=True)
  category = Column(String(50))


class DailyPrice(Base):
  __tablename__ = "daily_prices"
  __table_args__ = (
      UniqueConstraint(
          "market_id",
          "commodity_id",
          "date",
          name="uq_daily_price_mkt_comm_date",
      ),
      Index("ix_daily_prices_date", "date"),
  )

  id = Column(Integer, primary_key=True, autoincrement=True)
  market_id = Column(Integer, ForeignKey("markets.id"), nullable=False)
  commodity_id = Column(Integer, ForeignKey("commodities.id"), nullable=False)
  date = Column(Date, nullable=False)
  modal_price_inr = Column(Float, nullable=False)
  min_price_inr = Column(Float)
  max_price_inr = Column(Float)


class WeatherData(Base):
  __tablename__ = "weather_data"
  __table_args__ = (
      UniqueConstraint("region_name", "date", name="uq_weather_region_date"),
  )

  id = Column(Integer, primary_key=True, autoincrement=True)
  region_name = Column(String(100), nullable=False)
  date = Column(Date, nullable=False)
  temperature_max_c = Column(Float)
  temperature_min_c = Column(Float)
  precipitation_mm = Column(Float)


def init_db(db_url="sqlite:///data/food_price_intelligence.db"):
  os.makedirs("data", exist_ok=True)
  engine = create_engine(db_url)
  Base.metadata.create_all(engine)
  Session = sessionmaker(bind=engine)
  return Session()